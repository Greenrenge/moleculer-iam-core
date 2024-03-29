import { IAMErrors } from "../../idp"
import { ProviderConfigBuilder } from "../proxy"
import { ApplicationBuildOptions } from "./index"

export function buildFederateRoutes(
  builder: ProviderConfigBuilder,
  opts: ApplicationBuildOptions,
): void {
  const federation = builder.app.federation
  builder.app.router
    .post("/federate", async (ctx, next) => {
      ctx.op.assertPrompt()
      //@ts-ignore
      const provider = ctx.request.body.provider
      return federation.handleRequest(ctx, next, provider)
    })

    // handle federation callback
    .get("/federate/:provider", async (ctx, next) => {
      ctx.op.assertPrompt()
      const provider = ctx.params.provider
      const user = await federation.handleCallback(ctx, next, provider)
      if (!user) {
        throw new IAMErrors.IdentityNotExists()
      }

      // make user signed in
      return ctx.op.redirectWithUpdate({
        login: {
          account: user.id,
          remember: true,
        },
      })
    })
    .post("/federate/:provider", async (ctx, next) => {
      //@ts-ignore
      const { state, code } = ctx.request.body
      ctx.redirect(`/op/federate/apple?code=${code}&state=${state}`)
      return
    })
}
