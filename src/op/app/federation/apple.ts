import AppleStrategy from "passport-apple";
import { IdentityFederationProviderConfiguration, OIDCAccountClaims } from "../../proxy";
import { OIDCProviderProxyErrors } from "../../proxy/error";
export type AppleProviderConfiguration = IdentityFederationProviderConfiguration<AppleStrategy.Profile, AppleStrategy.AuthenticateOptions>;


export const appleProviderConfiguration: Omit<AppleProviderConfiguration, 'clientSecret'> = {
  clientID: '',
  teamID: '',
  keyID: '',
  callbackURL: '',
  privateKeyString: '',
  scope: "openid email name impersonation",
  strategy: (options, verify) => {
    return new AppleStrategy({
      ...options, privateKeyString: (options.privateKeyString as any).replace( /\\n/g, '\n')}
      , verify as any
    );
  },
  callback: async (args) => {
    const {accessToken, refreshToken, profile, decodedIdToken, scope, idp, logger} = args;

    // gather federation metadata
    const userEmail = decodedIdToken && decodedIdToken.email ? decodedIdToken.email : '';
    const metadata = { federation: {apple: {id: decodedIdToken && decodedIdToken.sub || '' }}};

    // gather claims
    const claims: Partial<OIDCAccountClaims> = {
      // extract temporary name from email
      name: userEmail.substring(0, userEmail.lastIndexOf("@")),
      email: userEmail || null,
      email_verified: true,
    };

    if (!userEmail) {
      // no email
      throw new OIDCProviderProxyErrors.FederationRequestWithoutEmailPayload();
    }

    // find existing account
    let identity = await idp.find({metadata});

    // connect the identity which has same email address
    if (!identity && userEmail) {
      // user email exist but no identity
      identity = await idp.find({claims: {email: userEmail}});
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
