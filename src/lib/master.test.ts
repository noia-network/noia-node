import WebSocket from "ws";
import Wire from "@noia-network/protocol";
import http from "http";

const Master = require("./master");

const masterPort = 6565;
const masterHost = "127.0.0.1";
const masterAddress = `ws://${masterHost}:${masterPort}`;

let masterWire = null;

const node = {
    id: "node-id",
    host: "0.0.0.0",
    port: "12345"
};

let masterServer: any = null;
let wss: any = null;
beforeEach(() => {
    masterServer = http.createServer();
    wss = new WebSocket.Server({ server: masterServer });
});

afterEach(done => {
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

it("connects to master and exits grafecully", done => {
    _connection((ws: any) => new Wire(ws));
    _listen(() => {
        const master = new Master(node, masterAddress);
        master.on("connected", () => master.close());
        master.on("closed", () => done());
        master.connect();
    });
});

it("sends upload event", done => {
    const infoHash = "my-info-hash";
    const uploaded = 123;
    const host = "1.2.3.4";
    const port = "00000";
    _connection((ws: any) => {
        const wire = new Wire(ws);
        wire.on("uploaded", (info: any) => {
            expect(info.nodeId).toBe(node.id);
            expect(info.ip).toBe(host);
            expect(info.infoHash).toBe(infoHash);
            expect(info.uploaded).toBe(uploaded);
            expect(info.timestamp).toBeDefined();
            _closeAll(done);
        });
    });
    _listen(() => {
        const master = new Master(node, masterAddress);
        master.on("connected", () => {
            master.uploaded(infoHash, uploaded, host, port);
        });
        master.connect();
    });
});

it("emits close with reason (error)");
it("emits close with reason (normal)");
