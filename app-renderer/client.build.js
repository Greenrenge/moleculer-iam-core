/* react-app-rewired: config-overrides.js */
const {
  removeModuleScopePlugin,
  babelInclude,
  fixBabelImports,
  override,
  overrideDevServer,
  addWebpackPlugin,
  addWebpackAlias,
  addWebpackModuleRule,
  addWebpackResolve,
  getBabelLoader,
  addBabelPreset,
  addBabelPlugin,
} = require("customize-cra")
const path = require("path")
const fs = require("fs")
const serverConfig = require("./server.config")

// ref: https://github.com/react-navigation/react-navigation/issues/6757#issuecomment-583319859
// shim react-navigation missing types by edit code directly

Object.entries({
  DrawerRouter: [
    "DrawerActionType",
    "DrawerNavigationState",
    "DrawerRouterOptions",
  ],
  StackRouter: [
    "StackActionType",
    "StackNavigationState",
    "StackRouterOptions",
  ],
  TabRouter: ["TabActionType", "TabNavigationState", "TabRouterOptions"],
}).forEach(([file, types]) => {
  const filePath = require.resolve(
    `@react-navigation/routers/lib/module/${file}.js`,
  )
  const code = fs.readFileSync(filePath).toString()
  if (code.endsWith("/*shim-added*/")) return
  fs.writeFileSync(
    filePath,
    `${code}\n${types
      .map((type) => `export const ${type} = null;`)
      .join("\n")}/*shim-added*/`,
  )
})

// ref: https://github.com/arackaf/customize-cra
// ref: https://github.com/timarney/react-app-rewired
module.exports = {
  // testing configuration
  jest: () => {
    return {
      preset: "react-native-web",
      transformIgnorePatterns: [],
      // force universal modules to prefer *.web.[ext] to *.native.[ext]
      haste: {
        defaultPlatform: "web",
        platforms: ["web"],
      },
      moduleNameMapper: {
        // mocking non-universal modules
        "\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$":
          "<rootDir>/__mocks__/file.js",
        "\\.(css|less)$": "<rootDir>/__mocks__/empty.js",
        "^react-native-svg$": "react-native-svg-mock",
        "^react-native-gesture-handler$":
          "<rootDir>/__mocks__/react-native-gesture-handler.js",

        // use shimmed react-native-web
        // "^react-native$": "<rootDir>/client.rnw.tsx",
      },
    }
  },

  // webpack configuration
  webpack: override(
    // addWebpackResolve({
    //   fallback: {
    // path: require.resolve("path-browserify"),
    // fs: require.resolve("memfs"),
    // buffer: require.resolve("buffer"),
    // stream: require.resolve("stream-browserify"),
    // util: require.resolve("util"),
    // assert: require.resolve("assert"),
    // crypto: require.resolve("crypto-browserify"),
    // http: require.resolve("stream-http"),
    // https: require.resolve("https-browserify"),
    // os: require.resolve("os-browserify/browser"),
    // zlib: require.resolve("browserify-zlib"),
    // constants: require.resolve("constants-browserify"),
    // vm: require.resolve("vm-browserify"),
    // url: require.resolve("url"),
    // querystring: require.resolve("querystring-es3"),
    // punycode: require.resolve("punycode"),
    // process: require.resolve("process/browser"),
    // timers: require.resolve("timers-browserify"),
    //   },
    // }),
    // remove module scope to include inject.ts
    removeModuleScopePlugin(),
    addWebpackModuleRule({
      test: /\.(js|jsx|tsx|ts)$/,
      use: [
        {
          loader: require.resolve("babel-loader"),
          options: {
            presets: [require.resolve("metro-react-native-babel-preset")],
            plugins: [require.resolve("@babel/plugin-transform-react-jsx")],
          },
        },
      ],
    }),
    // define __DEV__ for some modules
    addWebpackPlugin(
      new (require("webpack").DefinePlugin)({
        __DEV__: process.env.NODE_ENV !== "production",
      }),
    ),

    // alias react-native to shimmed react-native-web module
    // fixBabelImports("module-resolver", {
    //   alias: {
    //     "react-native": path.resolve("./client.rnw.tsx"),
    //   },
    // }),
    // addWebpackAlias({
    //   "react-native": path.resolve("./client.rnw.tsx"),
    // }),

    // include untranspiled modules
    // addBabelPlugin(require.resolve("@babel/plugin-transform-react-jsx")),
    babelInclude([
      path.resolve("./app-renderer/src"),
      path.resolve("./app-renderer/client.ts"),
      // path.resolve("./client.rnw.tsx"),
      require.resolve("@react-navigation/stack"),
      require.resolve("react-native-screens"),
      // path.join(require.resolve("react-native-reanimated"), ".."),
      path.join(require.resolve("react-native-gesture-handler"), ".."),
      path.join(require.resolve("react-native-eva-icons"), ".."),

      ...(process.env.NODE_ENV !== "production"
        ? [path.join(require.resolve("@ui-kitten/components"), "../ui")]
        : []),
    ]),

    //copy public assets to output path
    addWebpackPlugin(
      new (require("copy-webpack-plugin"))({
        patterns: [
          {
            from: path.resolve(__dirname, "../public/favicon.ico"),
            to: serverConfig.webpack.output.path,
          },
        ],
      }),
    ),

    // set output path from common config
    (config) => {
      return {
        ...config,
        output: {
          ...config.output,
          ...serverConfig.webpack.output,
        },
      }
    },
  ),

  // set dev server path
  devServer: overrideDevServer((config) => {
    return {
      ...config,
      static: {
        directory: serverConfig.webpack.output.path, // dist-app-renderer
        // publicPath: serverConfig.webpack.output.publicPath, // /op/assets/
      },
      devMiddleware: {
        writeToDisk: true,
      },
      open: false, // why it doesn"t work...?
      // contentBase: serverConfig.webpack.output.path,
      // contentBasePublicPath: serverConfig.webpack.output.publicPath,
    }
  }),
  paths(paths) {
    // console.log("paths", paths)
    // console.log(
    //   Object.fromEntries(
    //     Object.entries(paths).map(([k, p]) => [
    //       k,
    //       typeof p === "string" ? p.split("src").join("app-renderer/src") : p,
    //     ]),
    //   ),
    // )
    return {
      // ...paths,
      ...Object.fromEntries(
        Object.entries(paths).map(([k, p]) => [
          k,
          typeof p === "string" ? p.split("src").join("app-renderer/src") : p,
        ]),
      ),
      // appTsConfig: path.resolve("./client.tsconfig.json"),
      appBuild: serverConfig.webpack.output.path,
    }
  },
}
