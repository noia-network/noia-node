import WebSocket from "ws";
import Wire from "@noia-network/protocol";
import http from "http";

import { Node } from "./index";

const masterPort = 6565;
const masterHost = "127.0.0.1";
const masterAddress = `ws://${masterHost}:${masterPort}`;
// TODO: refactor master mock

const storageDir = "./tests/tmp-node";
const id = "node-76458aba-0123-4fba-af0a-0914b3fb3745d";
const seedingInfoHashes = ["f8f40a6b918314b6ec7cb71d487aec1d529b163b"];

let masterServer: any = null;
let wss: any = null;
beforeEach(() => {
    // rimraf.sync(storageDir)
    masterServer = http.createServer();
    wss = new WebSocket.Server({ server: masterServer });
});

afterEach(done => {
    // rimraf.sync(storageDir)
    _closeAll(done);
});

function _closeAll(cb: any) {
    wss.clients.forEach((ws: any) => ws.close());
    masterServer.close(() => {
        cb();
    });
}

function _connection(cb: any) {
    wss.on("connection", (ws: any, req: any) => {
        cb(ws);
    });
}

function _listen(cb: any) {
    masterServer.listen(masterPort, masterHost, (err: any) => {
        if (err) {
            throw new Error(err);
        }
        cb();
    });
}

it("starts and stops gracefully", done => {
    const node = new Node({
        id: id,
        ws: false,
        http: false,
        storageDir: storageDir,
        storageSize: 1048576
    });
    node.on("started", () => {
        setTimeout(() => {
            node.stop().then(() => done());
        }, 250);
    });
    node.on("error", (error: Error) => {
        throw new Error(error.message);
    });
    node.start();
});

it("listens and closes http connnection", done => {
    const node = new Node({
        id: id,
        ws: false,
        http: true,
        storageDir: storageDir,
        storageSize: 1048576
    });
    node.on("error", (error: Error) => {
        throw new Error(error.message);
    });
    node.clientSockets.http.on("listening", (info: any) => {
        if (typeof info === "undefined") {
            throw new Error("info undefined");
        }
        node.stop();
    });
    node.clientSockets.http.on("closed", (info: any) => {
        if (typeof info === "undefined") {
            throw new Error("info undefined");
        }
        done();
    });
    node.start();
});

it("listens and closes master connection", done => {
    expect.assertions(1);
    const masterReady = jest.fn();

    _connection((ws: any) => new Wire(ws));
    _listen(() => {
        const node = new Node({
            masterAddress,
            ws: false,
            http: true,
            storageDir: storageDir,
            storageSize: 1048576
        });
        node.on("error", (error: Error) => {
            throw new Error(error.message);
        });
        process.nextTick(() => {
            node.master.on("connected", (info: any) => {
                masterReady();
                node.stop();
            });
            node.master.on("closed", (info: any) => {
                expect(masterReady).toHaveBeenCalled();
                done();
            });
        });
        node.start();
    });
});

it("emits seeding contents", done => {
    expect.assertions(4);
    const seeding = jest.fn();

    let node: any = null;

    _connection((ws: any) => {
        const wire = new Wire(ws);
        wire.on("seeding", (info: any) => {
            if (info.infoHashes === 0) return;
            expect(info.infoHashes[0]).toBe(seedingInfoHashes[0]);
            expect(seeding).toHaveBeenCalled();
            node.stop().then(() => done());
        });
    });
    _listen(() => {
        node = new Node({
            masterAddress: masterAddress,
            ws: false,
            http: true,
            storageDir: "./tests/storage/",
            storageSize: 1048576
        });
        node.on("error", (error: any) => {
            throw new Error(error);
        });
        node.setId(id);
        node.on("started", () => {
            node.contentsClient.on("seeding", (infoHashes: any) => {
                expect(seedingInfoHashes).toEqual(expect.arrayContaining(infoHashes));
                expect(infoHashes[0]).toBe(seedingInfoHashes[0]);
                seeding();
            });
        });
        node.start();
    });
});
