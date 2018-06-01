const bodyParser = require("body-parser")
const express = require("express")
const fs = require("fs")
const logger = require("./logger")
const readline = require("readline")
const router = express.Router()
const swaggerDocument = require("../../swagger.json")
const swaggerUi = require("swagger-ui-express")

const app = express()

// swagger requirements
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument))
app.use("/api", router)

class NodeController {
  public node: any

  constructor (node: any) {
    router.route("/contents")
      .get((req: any, res: any, next: any) => {
        res.json(node.contentsClient.getInfoHashes())  
      })
    router.route("/settings")
      .get((req: any, res: any, next: any) => {
        res.json(node.settings.get())
      })
    router.route("/logs")
      .get((req: any, res: any, next: any) => {
        const data: Array<Object> = []
        const filepath = "./noia-node.log"
        fs.stat(filepath, (err: any, stat: any) => {
          if (err) {
            res.json([])
            return logger.warn(err)
          }
          if (stat && stat.isFile()) {
            const rl = readline.createInterface({
              input: fs.createReadStream(filepath),
              crlfDelay: Infinity
            })
            rl.on("line", (line: string) => {
              let parsedLine
              try {
                parsedLine = JSON.parse(line)
                data.push(JSON.parse(line))
              } catch(e) {
                logger.warn("Could not parse log line")
              }
            })
            rl.on("close", (input: string) => {
              res.json(data)
            })
          }
       })
      })
    app.listen(9000)
  }
}

export = NodeController