import * as _ from "lodash"
import kleur from "kleur"
import { Logger } from "../../lib/logger"
import { FindOptions, WhereAttributeHash } from "../../lib/rdbms"
import { OIDCAccountClaims, OIDCAccountCredentials } from "../../op"
import { defaultIdentityMetadata, IdentityMetadata } from "../metadata"
import { IdentityClaimsSchema } from "../claims"
import {
  ValidationSchema,
  ValidationError,
  validator,
} from "../../lib/validator"
import { IAMErrors } from "../error"
import { v4 as uuid } from "uuid"

export type IDPAdapterProps = {
  logger?: Logger
}

export interface Transaction {
  commit(): Promise<void>

  rollback(): Promise<void>
}

export abstract class IDPAdapter {
  protected readonly logger: Logger
  public abstract readonly displayName: string

  constructor(protected readonly props: IDPAdapterProps, options?: any) {
    this.logger = props.logger || console
  }

  /* Lifecycle methods: do sort of DBMS schema migration and making connection */
  public async start(): Promise<void> {
    this.logger.info(
      `${kleur.blue(
        this.displayName,
      )} identity provider adapter has been started`,
    )
  }

  public async stop(): Promise<void> {
    this.logger.info(
      `${kleur.blue(
        this.displayName,
      )} identity provider adapter has been stopped`,
    )
  }

  /* CRD identity */

  // args will be like { claims:{}, metadata:{}, ... }
  public abstract find(args: WhereAttributeHash): Promise<string | void>

  // args will be like { claims:{}, metadata:{}, ... }
  public abstract count(args: WhereAttributeHash): Promise<number>

  // args will be like { where: { claims:{}, metadata:{}, ...}, offset: 0, limit: 100, ... }
  public abstract get(args: FindOptions): Promise<string[]>

  public async validate(args: {
    id?: string
    scope: string[]
    claims: Partial<OIDCAccountClaims>
    credentials?: Partial<OIDCAccountCredentials>
  }): Promise<void> {
    const {
      validateClaims,
      validateClaimsImmutability,
      validateClaimsUniqueness,
    } = await this.getCachedActiveClaimsSchemata(args.scope)
    const mergedResult: ValidationError[] = []
    // validate claims
    let result = await validateClaims(args.claims)
    if (result !== true) {
      mergedResult.push(
        ...result.map((e) => {
          e.field = `claims.${e.field}`
          return e
        }),
      )
    }

    // validate immutable
    if (args.id) {
      result = await validateClaimsImmutability(args.id, args.claims)
      if (result !== true) {
        mergedResult.push(
          ...result.map((e) => {
            e.field = `claims.${e.field}`
            return e
          }),
        )
      }
    }
    // validate uniqueness
    result = await validateClaimsUniqueness(args.id, args.claims)
    if (result !== true) {
      mergedResult.push(
        ...result.map((e) => {
          e.field = `claims.${e.field}`
          return e
        }),
      )
    }

    // validate credentials
    if (args.credentials && Object.keys(args.credentials).length > 0) {
      result = await this.testCredentials(args.credentials)
      if (result !== true) {
        mergedResult.push(
          ...result.map((e) => {
            e.field = `credentials.${e.field}`
            return e
          }),
        )
      }
    }

    if (mergedResult.length > 0) {
      throw new IAMErrors.ValidationFailed(mergedResult)
    }
  }

  public async create(
    args: {
      metadata: Partial<IdentityMetadata>
      scope: string[]
      claims: OIDCAccountClaims
      credentials: Partial<OIDCAccountCredentials>
    },
    transaction?: Transaction,
    ignoreUndefinedClaims?: boolean,
  ): Promise<string> {
    const {
      metadata = {},
      claims = {} as OIDCAccountClaims,
      credentials = {},
      scope = [],
    } = args || {}

    if (claims && !claims.sub) {
      claims.sub = uuid()
    }

    if (scope && scope.length !== 0 && !scope.includes("openid")) {
      scope.push("openid")
    }

    // save metadata, claims, credentials
    let isolated = false
    if (!transaction) {
      transaction = transaction = await this.transaction()
      isolated = true
    }
    const id = claims.sub
    try {
      await this.createOrUpdateMetadata(
        id,
        _.defaultsDeep(metadata, defaultIdentityMetadata),
        transaction,
      )
      await this.createOrUpdateClaimsWithValidation(
        id,
        claims,
        scope,
        true,
        transaction,
        ignoreUndefinedClaims,
      )
      await this.createOrUpdateCredentialsWithValidation(
        id,
        credentials,
        transaction,
      )
      if (isolated) {
        await transaction.commit()
      }
    } catch (err) {
      if (isolated) {
        await transaction.rollback()
      }
      throw err
    }

    return id
  }

  public abstract delete(
    id: string,
    transaction?: Transaction,
  ): Promise<boolean>

  /* fetch and create claims entities (versioned) */
  public async getClaims(
    id: string,
    scope: string[],
  ): Promise<OIDCAccountClaims> {
    // get active claims
    const { claimsSchemata } = await this.getCachedActiveClaimsSchemata(scope)
    const claims = (await this.getVersionedClaims(
      id,
      claimsSchemata.map((schema) => ({
        key: schema.key,
        schemaVersion: schema.version,
      })),
    )) as OIDCAccountClaims

    for (const schema of claimsSchemata) {
      if (typeof claims[schema.key] === "undefined") {
        claims[schema.key] = null
      }
    }

    return claims
  }

  protected readonly getCachedActiveClaimsSchemata = _.memoize(
    async (scope: string[]) => {
      // get schemata
      const claimsSchemata = await this.getClaimsSchemata({
        scope,
        active: true,
      })
      const activeClaimsVersions = claimsSchemata.reduce((obj, schema) => {
        obj[schema.key] = schema.version
        return obj
      }, {} as { [key: string]: string })
      const validClaimsKeys = claimsSchemata.map((s) => s.key)
      const duplicatedClaimsToDelete: {
        holderId: string
        key: string
      }[] = []
      // get unique claims schemata
      const uniqueClaimsSchemata = claimsSchemata.filter((s) => s.unique)
      const uniqueClaimsSchemataKeys = uniqueClaimsSchemata.map((s) => s.key)
      const validateClaimsUniqueness = async (
        id: string | void,
        object: { [key: string]: any },
      ): Promise<true | ValidationError[]> => {
        if (uniqueClaimsSchemata.length === 0) return true
        const errors: ValidationError[] = []
        for (const key of uniqueClaimsSchemataKeys) {
          const value = object[key]
          if (typeof value === "object" && value !== null) {
            errors.push({
              type: "duplicate",
              field: key,
              actual: value,
              message: `The '${key}' value cannot have uniqueness trait.`,
            })
            continue
          }

          const holderId = await this.find({ claims: { [key]: value } })
          if (holderId && id !== holderId) {
            if (key === "fcm_registration_token") {
              duplicatedClaimsToDelete.push({
                holderId,
                key,
              })
            } else {
              errors.push({
                type: "duplicate",
                field: key,
                actual: value,
                message: `The '${key}' value is already used by other account.`,
              })
            }
          }
        }
        return errors.length > 0 ? errors : true
      }

      // get immutable claims schemata
      const immutableClaimsSchemata = claimsSchemata.filter((s) => s.immutable)
      const immutableClaimsSchemataScope = immutableClaimsSchemata.map(
        (s) => s.scope,
      )
      const immutableClaimsSchemataKeys = immutableClaimsSchemata.map(
        (s) => s.key,
      )
      const validateClaimsImmutability = async (
        id: string,
        object: { [key: string]: any },
      ): Promise<true | ValidationError[]> => {
        if (immutableClaimsSchemata.length === 0) return true

        const errors: ValidationError[] = []
        const oldClaims = await this.getClaims(id, immutableClaimsSchemataScope)
        for (const key of immutableClaimsSchemataKeys) {
          const oldValue = oldClaims[key]
          const newValue = object[key]
          if (
            typeof newValue !== "undefined" &&
            typeof oldValue !== "undefined" &&
            oldValue !== null &&
            oldValue !== newValue
          ) {
            errors.push({
              type: "immutable",
              field: key,
              message: `The '${key}' field value cannot be updated.`,
              actual: newValue,
              expected: oldValue,
            })
          }
        }
        return errors.length > 0 ? errors : true
      }

      // prepare to validate and merge old claims
      const claimsValidationSchema = claimsSchemata.reduce(
        (obj, claimsSchema) => {
          obj[claimsSchema.key] = claimsSchema.validation
          return obj
        },
        {
          $$strict: true,
        } as ValidationSchema,
      )
      const validateClaims = validator.compile(claimsValidationSchema)

      return {
        activeClaimsVersions,
        claimsSchemata,
        validateClaims,
        validClaimsKeys,
        uniqueClaimsSchemata,
        validateClaimsUniqueness,
        immutableClaimsSchemata,
        validateClaimsImmutability,
        duplicatedClaimsToDelete,
      }
    },
    (...args: any[]) => JSON.stringify(args),
  )
  private mergeClaims(
    newClaims: Partial<OIDCAccountClaims>,
    oldCliams: Partial<OIDCAccountClaims>,
  ): Partial<OIDCAccountClaims> {
    let result
    if (
      oldCliams.sports === null &&
      newClaims.sports &&
      newClaims.sports.teams &&
      newClaims.sports.teams.length === 0
    ) {
      result = _.assignIn(newClaims, oldCliams)
    } else if (
      newClaims.sports &&
      newClaims.sports.teams &&
      newClaims.sports.teams.length === 0
    ) {
      result = {
        ...oldCliams,
        ...newClaims,
        sports: {
          ...oldCliams.sports,
          ...newClaims.sports,
        },
      }
    } else {
      result = _.defaults(newClaims, oldCliams)
    }
    return result
  }

  public async createOrUpdateClaimsWithValidation(
    id: string,
    claims: Partial<OIDCAccountClaims>,
    scope: string[],
    creating: boolean,
    transaction?: Transaction,
    ignoreUndefinedClaims?: boolean,
  ): Promise<void> {
    const {
      activeClaimsVersions,
      claimsSchemata,
      validClaimsKeys,
      duplicatedClaimsToDelete,
    } = await this.getCachedActiveClaimsSchemata(scope)

    // merge old claims and validate merged one
    const oldClaims = await this.getClaims(id, scope)
    const mergedClaims: Partial<OIDCAccountClaims> = this.mergeClaims(
      claims,
      oldClaims,
    )

    if (ignoreUndefinedClaims === true) {
      const ignoredClaims: any = {}
      for (const key of Object.keys(mergedClaims)) {
        if (!validClaimsKeys.includes(key)) {
          ignoredClaims[key] = mergedClaims[key]
          delete mergedClaims[key]
        }
      }
      this.logger.debug(
        "IDP ignored undefined claims (ignoreUndefinedClaims flag enabled)",
        {
          claims: mergedClaims,
          ignoredClaims,
        },
      )
    }

    try {
      await this.validate({
        id: creating ? undefined : id,
        scope,
        claims: mergedClaims,
      })
    } catch (err) {
      ;(err as any).error_detail = { claims, mergedClaims, scope }
      throw err
    }

    let isolated = false
    if (!transaction) {
      isolated = true
      transaction = await this.transaction()
    }

    try {
      // FIXME: multiple devices should be supported
      // delete for duplicated fcm token duplicatedClaimsToDelete can contain fcm_registration_token
      if (duplicatedClaimsToDelete.length > 0) {
        for await (const duplicatedClaimToDelete of duplicatedClaimsToDelete) {
          const oldClaimsForDuplicatedClaimHolder = await this.getClaims(
            duplicatedClaimToDelete.holderId,
            scope,
          )
          const duplicatedClaim: any = {
            [duplicatedClaimToDelete.key]: null,
          }
          const mergedClaimsForDuplicatedClaimHolder: Partial<OIDCAccountClaims> =
            this.mergeClaims(duplicatedClaim, oldClaimsForDuplicatedClaimHolder)
          const validClaimEntriesForDuplicatedClaimHolder = Array.from(
            Object.entries(mergedClaimsForDuplicatedClaimHolder),
          ).filter(([key]) => activeClaimsVersions[key])

          await this.createOrUpdateVersionedClaims(
            duplicatedClaimToDelete.holderId,
            validClaimEntriesForDuplicatedClaimHolder.map(([key, value]) => ({
              key,
              value,
              schemaVersion: activeClaimsVersions[key],
            })),
            transaction,
          )

          await this.onClaimsUpdated(
            duplicatedClaimToDelete.holderId,
            validClaimEntriesForDuplicatedClaimHolder.reduce(
              (obj, [key, claim]) => {
                obj[key] = claim
                return obj
              },
              {} as Partial<OIDCAccountClaims>,
            ),
            transaction,
          )

          // set metadata scope
          if (id !== duplicatedClaimToDelete.holderId) {
            await this.createOrUpdateMetadata(
              duplicatedClaimToDelete.holderId,
              {
                scope: claimsSchemata.reduce((obj, s) => {
                  obj[s.scope] = false
                  return obj
                }, {} as { [k: string]: boolean }),
              },
              transaction,
            )
          }
        }
      }
      // update claims
      const validClaimEntries = Array.from(Object.entries(mergedClaims)).filter(
        ([key]) => activeClaimsVersions[key],
      )

      await this.createOrUpdateVersionedClaims(
        id,
        validClaimEntries.map(([key, value]) => ({
          key,
          value,
          schemaVersion: activeClaimsVersions[key],
        })),
        transaction,
      )

      // set metadata scope
      const meta = claimsSchemata.reduce((obj, s) => {
        obj[s.scope] = true
        return obj
      }, {} as { [k: string]: boolean })
      await this.createOrUpdateMetadata(
        id,
        {
          scope: claimsSchemata.reduce((obj, s) => {
            obj[s.scope] = true
            return obj
          }, {} as { [k: string]: boolean }),
        },
        transaction,
      )

      // notify update for cache
      await this.onClaimsUpdated(
        id,
        validClaimEntries.reduce((obj, [key, claim]) => {
          obj[key] = claim
          return obj
        }, {} as Partial<OIDCAccountClaims>),
        transaction,
      )

      if (isolated) {
        await transaction.commit()
      }
    } catch (error) {
      if (isolated) {
        await transaction.rollback()
      }
      throw error
    }
  }

  public async deleteClaims(
    id: string,
    scope: string[],
    transaction?: Transaction,
  ): Promise<void> {
    const { claimsSchemata } = await this.getCachedActiveClaimsSchemata(scope)

    let isolated = false
    if (!transaction) {
      isolated = true
      transaction = await this.transaction()
    }

    try {
      // update claims as null
      await this.createOrUpdateVersionedClaims(
        id,
        claimsSchemata.map((schema) => ({
          key: schema.key,
          value: null,
          schemaVersion: schema.version,
        })),
        transaction,
      )

      // set metadata scope as false
      await this.createOrUpdateMetadata(
        id,
        {
          scope: scope.reduce((obj, s) => {
            obj[s] = false
            return obj
          }, {} as { [k: string]: boolean }),
        },
        transaction,
      )

      // notify update for cache
      await this.onClaimsUpdated(
        id,
        claimsSchemata.reduce((obj, schema) => {
          obj[schema.key] = null
          return obj
        }, {} as Partial<OIDCAccountClaims>),
        transaction,
      )

      if (isolated) {
        await transaction.commit()
      }
    } catch (error) {
      if (isolated) {
        await transaction.rollback()
      }
      throw error
    }
  }

  public abstract onClaimsUpdated(
    id: string,
    updatedClaims: Partial<OIDCAccountClaims>,
    transaction?: Transaction,
  ): Promise<void>

  public abstract createOrUpdateVersionedClaims(
    id: string,
    claims: { key: string; value: any; schemaVersion: string }[],
    transaction?: Transaction,
  ): Promise<void>

  public abstract getVersionedClaims(
    id: string,
    claims: { key: string; schemaVersion?: string }[],
  ): Promise<Partial<OIDCAccountClaims>>

  public abstract createClaimsSchema(
    schema: IdentityClaimsSchema,
    transaction?: Transaction,
  ): Promise<void>

  public abstract forceDeleteClaimsSchema(
    key: string,
    transaction?: Transaction,
  ): Promise<void>

  public async onClaimsSchemaUpdated(): Promise<void> {
    this.getCachedActiveClaimsSchemata.cache.clear!()
  }

  public abstract getClaimsSchema(args: {
    key: string
    version?: string
    active?: boolean
  }): Promise<IdentityClaimsSchema | void>

  // scope: [] means all scopes
  public abstract getClaimsSchemata(args: {
    scope: string[]
    key?: string
    version?: string
    active?: boolean
  }): Promise<IdentityClaimsSchema[]>

  public abstract setActiveClaimsSchema(
    args: { key: string; version: string },
    transaction?: Transaction,
  ): Promise<void>

  /* identity metadata (for federation information, soft deletion, etc. not-versioned) */
  public abstract getMetadata(id: string): Promise<IdentityMetadata | void>

  public abstract createOrUpdateMetadata(
    id: string,
    metadata: Partial<IdentityMetadata>,
    transaction?: Transaction,
  ): Promise<void>

  /* identity credentials */
  public abstract assertCredentials(
    id: string,
    credentials: Partial<OIDCAccountCredentials>,
  ): Promise<boolean | null>

  protected abstract createOrUpdateCredentials(
    id: string,
    credentials: Partial<OIDCAccountCredentials>,
    transaction?: Transaction,
  ): Promise<boolean>

  private readonly testCredentials = validator.compile({
    password: {
      type: "string",
      min: 8,
      max: 32,
      optional: true,
    },
    password_confirmation: {
      type: "equal",
      field: "password",
      optional: true,
    },
  })

  public async createOrUpdateCredentialsWithValidation(
    id: string,
    credentials: Partial<OIDCAccountCredentials>,
    transaction?: Transaction,
  ): Promise<boolean> {
    let isolated = false
    if (!transaction) {
      transaction = transaction = await this.transaction()
      isolated = true
    }
    try {
      await this.validateCredentials(credentials)

      const updated = await this.createOrUpdateCredentials(
        id,
        credentials,
        transaction,
      )
      await this.createOrUpdateMetadata(
        id,
        {
          credentials: Object.keys(credentials).reduce((obj, credType) => {
            obj[credType] = true
            return obj
          }, {} as { [k: string]: boolean }),
        },
        transaction,
      )

      if (isolated) {
        await transaction.commit()
      }
      return updated
    } catch (err) {
      if (isolated) {
        await transaction.rollback()
      }
      throw err
    }
  }

  public async validateCredentials(
    credentials: Partial<OIDCAccountCredentials>,
  ): Promise<void> {
    const result = await this.testCredentials(credentials)
    if (result !== true) {
      throw new IAMErrors.ValidationFailed(result)
    }
  }

  /* transaction and migration lock for distributed system */
  public abstract transaction(): Promise<Transaction>

  public abstract acquireMigrationLock(key: string): Promise<void>

  public abstract touchMigrationLock(
    key: string,
    migratedIdentitiesNumber: number,
  ): Promise<void>

  public abstract releaseMigrationLock(key: string): Promise<void>
}
