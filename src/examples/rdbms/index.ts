"use strict"

import { ServiceBroker } from "moleculer"
import { app } from "./app"
import { IAMServiceSchema } from "../.." // "moleculer-iam";

// create moleculer service (optional)
const broker = new ServiceBroker({
  transporter: {
    type: "TCP",
    options: {
      udpPeriod: 1,
    },
  },
  cacher: "Memory",
  requestTimeout: 7 * 1000, // in milliseconds,
  retryPolicy: {
    enabled: true,
    retries: 7,
    delay: 200,
    maxDelay: 3000,
    factor: 2,
    check: (err) => {
      return err && !!(err as any).retryable
    },
  },
  circuitBreaker: {
    enabled: true,
    threshold: 0.5,
    windowTime: 60,
    minRequestCount: 20,
    halfOpenTime: 10 * 1000,
    check: (err) => {
      return err && (err as any).code && (err as any).code >= 500
    },
  },
})

const serviceSchema = IAMServiceSchema({
  idp: {
    adapter: {
      // type: "Memory",
      type: "RDBMS",
      options: {
        dialect: "mysql",
        host: "mysql-dev-new.internal.qmit.pro",
        database: "iam",
        username: "iam",
        password: "iam",
        sqlLogLevel: "debug",
      },
    },
  },
  op: {
    issuer: "http://localhost:9090",
    dev: true,

    adapter: {
      // type: "Memory",
      type: "RDBMS",
      options: {
        dialect: "mysql",
        host: "mysql-dev-new.internal.qmit.pro",
        database: "iam",
        username: "iam",
        password: "iam",
        sqlLogLevel: "debug",
      },
    },

    // required and should be shared between processes in production
    cookies: {
      keys: ["blabla", "any secrets to encrypt", "cookies"],
    },

    // required and should be shared between processes in production
    jwks: require("./jwks.json"),

    app: {
      // federation
      federation: {
        google: {
          clientID: "XXX",
          clientSecret: "YYY",
        },
        facebook: {
          clientID: "XXX",
          clientSecret: "YYY",
        },
        kakao: {
          clientID: "XXX",
          clientSecret: "YYY",
        },
        apple: {
          clientID: "XXX",
          clientSecret: "YYY",
        },
        // custom: {
        //   clientID: "XXX",
        //   clientSecret: "YYY",
        //   callback: ({ accessToken, refreshToken, profile, idp, logger }) => {
        //     throw new Error("not implemented");
        //   },
        //   scope: "openid",
        //   strategy: () => {
        //     throw new Error("not implemented");
        //   },
        // },
      },
      renderer: {
        // factory: require("moleculer-iam-app"), // this is default behavior
        options: {
          logo: {
            uri: "https://upload.wikimedia.org/wikipedia/commons/a/a2/OpenID_logo_2.svg",
            align: "flex-start",
            height: "50px",
            width: "133px",
          },
          login: {
            federationOptionsVisibleDefault: false,
          },
          themes: {
            default: {
              themePrimary: "#ff6500",
              themeLighterAlt: "#f6f7fe",
              themeLighter: "#fce1f3",
              themeLight: "#facfd4",
              themeTertiary: "#f4909a",
              themeSecondary: "#ef7551",
              themeDarkAlt: "#d54627",
              themeDark: "#bc4014",
              themeDarker: "#a23414",
            },
          },
        },
      },
    },
    discovery: {
      ui_locales_supported: ["en-US", "ko-KR"],
      claims_locales_supported: ["en-US", "ko-KR"],
      op_tos_uri: "/help/tos",
      op_policy_uri: "/help/policy",
      service_documentation: "/help",
    },
  },
  server: {
    app,
    http: {
      hostname: "localhost",
      port: 9090,
    },
  },
})

broker.createService(serviceSchema)
broker.start()
