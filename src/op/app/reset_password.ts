import moment from "moment"
import { ProviderConfigBuilder } from "../proxy"
import { ApplicationErrors } from "./error"
import { ApplicationBuildOptions } from "./index"

export function buildResetPasswordRoutes(
  builder: ProviderConfigBuilder,
  opts: ApplicationBuildOptions,
): void {
  builder.app.router

    // initial render page
    .get("/reset_password", async (ctx) => {
      return ctx.op.render("reset_password")
    })

    // render set password page
    .get("/reset_password/set", async (ctx) => {
      if (
        !ctx.op.sessionPublicState.resetPassword ||
        !ctx.op.sessionPublicState.resetPassword.user
      ) {
        return ctx.op.redirect("/reset_password")
      }
      return ctx.op.render("reset_password")
    })

    .get("/reset_password/end", async (ctx) => {
      if (
        !ctx.op.sessionPublicState.resetPassword ||
        !ctx.op.sessionPublicState.resetPassword.user
      ) {
        return ctx.op.redirect("/reset_password")
      }
      return ctx.op.render("reset_password")
    })

    .post("/reset_password/set", async (ctx) => {
      //@ts-ignore
      const {
        //@ts-ignore
        email = "",
        //@ts-ignore
        password = "",
        //@ts-ignore
        password_confirmation = "",
      } = ctx.request.body
      const claims = { email }

      await ctx.idp.validateEmailOrPhoneNumber(claims) // normalized email

      const publicState = ctx.op.sessionPublicState
      if (
        !(
          publicState &&
          publicState.resetPassword &&
          publicState.resetPassword.user &&
          publicState.resetPassword.user.email === claims.email &&
          publicState.resetPassword.expiresAt &&
          moment().isBefore(publicState.resetPassword.expiresAt)
        )
      ) {
        throw new ApplicationErrors.ResetPasswordSessionExpired()
      }

      const identity = await ctx.idp.findOrFail({ claims })
      await identity.updateCredentials({
        password,
        password_confirmation,
      })

      ctx.op.setSessionPublicState((prevState) => ({
        ...prevState,
        resetPassword: {
          ...prevState.resetPassword,
          expiresAt: null,
        },
      }))

      return ctx.op.end()
    })
}
