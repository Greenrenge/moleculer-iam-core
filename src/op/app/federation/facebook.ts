import { StrategyOption, Strategy, Profile } from "passport-facebook";
import { IdentityFederationProviderConfiguration, OIDCAccountClaims } from "../../proxy";
import { OIDCProviderProxyErrors } from "../../proxy/error";

export type FacebookProviderConfiguration = IdentityFederationProviderConfiguration<Profile, StrategyOption>;

// facebook is not a OIDC provider; openid scope not supported
// phone scope is not supported (seems only for the whatsapp platform apps)

export const facebookProviderConfiguration: FacebookProviderConfiguration = {
  clientID: "",
  clientSecret: "",
  scope: "public_profile email",
  profileFields: ["id", "name", "displayName", "photos", "email"],
  enableProof: true,
  strategy: (options, verify) => {
    return new Strategy(options as any, verify as any);
  },
  callback: async (args) => {
    const {accessToken, refreshToken, profile, scope, idp, logger} = args;
    console.log('facebook profile:', profile)

    // gather federation metadata
    const metadata = { federation: {facebook: {id: profile.id}}};

    // gather claims
    const claims: Partial<OIDCAccountClaims> = {
      name: (profile as any).displayName,
      picture: (profile as any).photos &&(profile as any).photos[0] && (profile as any).photos[0].value || null,
      email: (profile as any).emails && (profile as any).emails[0] && (profile as any).emails[0].value || null,
      email_verified: true,
    };

    if (!claims.email) {
      throw new OIDCProviderProxyErrors.FederationRequestWithoutEmailPayload();
    }

    if (!claims.picture) {
      delete claims.picture;
    }

    // find existing account
    let identity = await idp.find({metadata});

    // connect the identity which has same email address
    if (!identity && claims.email) {
      identity = await idp.find({claims: {email: claims.email}});
      // if (identity) {
      //   const oldClaims = await identity.claims("userinfo", "email");
      //   if (!oldClaims.email_verified) {
      //     throw new IAMErrors.UnexpectedError("cannot federate an existing account with non-verified email address");
      //   }
      // }
    }

    // update or create
    const upsertScopes = idp.claims.mandatoryScopes as string[];
    if (identity) {
      if (await identity.isSoftDeleted()) {
        throw new OIDCProviderProxyErrors.FederationRequestForDeletedAccount();
      }

      await identity.updateMetadata(metadata);
      await identity.updateClaims(claims, upsertScopes, undefined, true);
      return identity;
    } else {
      return idp.create({
        metadata,
        claims,
        credentials: {},
        scope: upsertScopes,
      }, undefined, true);
    }
  },
};
