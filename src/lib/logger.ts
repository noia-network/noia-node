const path = require("path")
const dotenv = require("dotenv").config({ path: path.resolve(process.cwd(), ".env")  })
const config = dotenv.error ? {} : dotenv.parsed
const logdna = require("logdna-winston")
const winston = require("winston");
// const path = module.filename.split("/").slice(-2).join("/");

const options = {
  transports: [
    new winston.transports.Console({
      colorize: true,
      label: "noia-node",
      json: false
    })
  ],
  // exceptionHandlers: [
  //   new winston.transports.Console({
  //     colorize: true,
  //     // label: path,
  //     json: false
  //   })
  // ],
  exitOnError: false,
}

if (config.LOG_TO_FILE === "yes") {
  options.transports.push(new winston.transports.File({
    filename: "noia-node.log",
    // label: path,
    json: true
  }))
  // options.exceptionHandlers.push(new winston.transports.File({
  //   filename: "noia-node-unhandled.log",
  //   // label: path,
  //   json: false
  // }))
}

if (config.LOGDNA_API_KEY) {
  const settings: any = {
    app: "Node",
    handleExceptions: true,
    json: false,
    key: config.LOGDNA_API_KEY
  }
  if (config.LOGDNA_API_KEY)  {
    settings.hostname = config.LOGDNA_HOSTNAME
  }
  options.transports.push(new winston.transports.Logdna(settings))
}

export = new winston.Logger(options)
