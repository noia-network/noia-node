import bodyParser from "body-parser";
import express from "express";
import fs from "fs";
import readline from "readline";
import swaggerUi from "swagger-ui-express";

import logger from "./logger";
import { Options } from "./settings";

const router = express.Router();
const swaggerDocument = require("../../swagger.json");
const app = express();

// swagger requirements
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use("/api", router);

class NodeController {
    public node: any;

    constructor(node: any) {
        router.route("/statistics").get((req: any, res: any, next: any) => {
            res.json(node.statistics.get());
        });
        router.route("/storage").get((req: any, res: any, next: any) => {
            node.storageSpace.stats().then((stats: any) => {
                res.json(stats);
            });
        });
        router.route("/contents").get((req: any, res: any, next: any) => {
            res.json(node.contentsClient.getInfoHashes());
        });
        router.route("/settings").get((req: any, res: any, next: any) => {
            res.json(node.settings.get());
        });
        router.route("/logs").get((req: any, res: any, next: any) => {
            const data: Array<Object> = [];
            const filepath = "./noia-node.log";
            fs.stat(filepath, (err: any, stat: any) => {
                if (err) {
                    res.json([]);
                    return logger.warn(err);
                }
                if (stat && stat.isFile()) {
                    const rl = readline.createInterface({
                        input: fs.createReadStream(filepath),
                        crlfDelay: Infinity
                    });
                    rl.on("line", (line: string) => {
                        let parsedLine;
                        try {
                            parsedLine = JSON.parse(line);
                            data.push(JSON.parse(line));
                        } catch (e) {
                            logger.warn("Could not parse log line");
                        }
                    });
                    rl.on("close", (input: string) => {
                        res.json(data);
                    });
                }
            });
        });
        app.listen(node.settings.get(Options.controllerPort), node.settings.get(Options.controllerIp));
    }
}

export = NodeController;
