import * as path from "path";
import bodyParser from "body-parser";
import express from "express";
import fs from "fs";
import jsonfile from "jsonfile";
import readline from "readline";
import swaggerUi from "swagger-ui-express";

import { Node } from "./node";
import { SettingsEnum } from "./settings";
import { logger } from "./logger";

const router = express.Router();
// TODO: Do not use "require()" for file reading.
const swaggerDocument = jsonfile.readFileSync(path.resolve(__dirname, "../swagger.json"));
const app = express();

// swagger requirements
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use("/api", router);

export class NodeController {
    constructor(public node: Node) {
        router.route("/statistics").get((req: any, res: any, next: any) => {
            res.json(this.node.statistics.statistics);
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
            res.json(node.settings.options);
        });
        router.route("/logs").get((req: any, res: any, next: any) => {
            const data: object[] = [];
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
        app.listen(node.settings.options[SettingsEnum.controllerPort], node.settings.options[SettingsEnum.controllerIp]);
    }
}
