import EventEmitter from "events";

import ClientSocketHttp from "./client-socket-http";
import ClientSocketWrtc from "./client-socket-wrtc";
import ClientSocketWs from "./client-socket-ws";
import Node from "../index";

class ClientSockets extends EventEmitter {
    public opts: any;
    public _node: Node;
    public http: ClientSocketHttp;
    public ws: ClientSocketWs;
    public wrtc: ClientSocketWrtc;

    constructor(node: Node, opts: any) {
        super();

        this.opts = opts || {};

        this._node = node;

        this.http = new ClientSocketHttp(this._node, this.opts.http.port, this.opts.http.ip);
        this.ws = new ClientSocketWs(this._node, this.opts.ws.port, this.opts.ws.ip, this.opts.ws);
        this.wrtc = new ClientSocketWrtc(this._node, this.opts.wrtc.controlPort, this.opts.wrtc.dataPort, this.opts.wrtc.controlIp);

        if (this.opts.http) {
            this.http.on("listening", (info: any) => {
                this.emit("listening", info);
            });
            this.http.on("error", err => {
                this.emit("error", err);
            });
            this.http.on("resourceSent", (info: any) => {
                this.emit("resourceSent", info);
            });
        }
        if (this.opts.ws) {
            this.ws.on("listening", (info: any) => {
                this.emit("listening", info);
            });
            this.ws.on("error", err => {
                this.emit("error", err);
            });
            this.ws.on("resourceSent", (info: any) => {
                this.emit("resourceSent", info);
            });
        }
        if (this.opts.wrtc) {
            this.wrtc.on("listening", (info: any) => {
                this.emit("listening", info);
            });
            this.wrtc.on("error", (err: any) => {
                this.emit("error", err);
            });
            this.wrtc.on("resourceSent", (info: any) => {
                this.emit("resourceSent", info);
            });
        }
    }

    listen() {
        if (this.opts.http && !this.http.listening) {
            this.http.listen();
        }

        if (this.opts.ws && !this.ws.server.listening) {
            this.ws.listen();
        }

        if (this.opts.wrtc && !this.wrtc.wrtc.server.listening) {
            this.wrtc.listen();
        }
    }

    close() {
        const self = this;

        Promise.all([_closeHttp(), _closeWs(), _closeWrtc()]).then(() => {
            // self.emit("destroyed")
            // self.emit("closed")
        });

        function _closeHttp() {
            return new Promise((resolve, reject) => {
                if (self.http && self.http.listening) {
                    if (self.http.listening) {
                        self.http.close().then((info: any) => {
                            self.emit("closed", info);
                            resolve(info);
                        });
                    } else {
                        self.http.once("listening", (info: any) => {
                            if (self.http)
                                self.http.close().then((info: any) => {
                                    self.emit("closed", info);
                                    resolve(info);
                                });
                        });
                    }
                } else {
                    resolve();
                }
            });
        }

        function _closeWs() {
            return new Promise((resolve, reject) => {
                if (self.ws && self.ws.server.listening) {
                    if (self.ws.server.listening) {
                        self.ws.close().then((info: any) => {
                            self.emit("closed", info);
                            resolve(info);
                        });
                    } else {
                        self.ws.once("listening", () => {
                            if (self.ws)
                                self.ws.close().then((info: any) => {
                                    self.emit("closed", info);
                                    resolve(info);
                                });
                        });
                    }
                } else {
                    resolve();
                }
            });
        }

        function _closeWrtc() {
            return new Promise((resolve, reject) => {
                if (self.wrtc && self.wrtc.wrtc.server.listening) {
                    if (self.wrtc.wrtc.server.listening) {
                        self.wrtc.close().then((info: any) => {
                            self.emit("closed", info);
                            resolve(info);
                        });
                    } else {
                        self.wrtc.once("listening", () => {
                            if (self.wrtc)
                                self.wrtc.close().then((info: any) => {
                                    self.emit("closed", info);
                                    resolve(info);
                                });
                        });
                    }
                } else {
                    resolve();
                }
            });
        }
    }
}

export = ClientSockets;
