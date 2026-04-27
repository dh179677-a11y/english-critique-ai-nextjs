const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, ".env.production");

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .reduce((acc, rawLine) => {
      const line = rawLine.trim();

      if (!line || line.startsWith("#")) {
        return acc;
      }

      const separatorIndex = line.indexOf("=");

      if (separatorIndex === -1) {
        return acc;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      if (!key) {
        return acc;
      }

      acc[key] = value;
      return acc;
    }, {});
};

module.exports = {
  apps: [
    {
      name: "english-critique-ai",
      script: "npm",
      args: "start",
      cwd: "/var/www/english-critique-ai",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        ...parseEnvFile(envFile),
      },
    },
  ],
};
