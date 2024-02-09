const path = require("path")

// build configuration
module.exports = {
  webpack: {
    output: {
      path: path.resolve(__dirname, "../", "./dist-app-renderer"),
      publicPath: "/op/assets/",
    },
  },
}
