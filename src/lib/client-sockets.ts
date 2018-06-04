import ClientSocketHttp from "./client-socket-http"
import ClientSocketWs from "./client-socket-ws"
import EventEmitter from "events"
import Node from "../index"

class ClientSockets extends EventEmitter {
  public opts: any
  public _node: Node
  public listeningHttp: boolean = false
  public listeningWs: boolean = false
  public http: ClientSocketHttp
  public ws: ClientSocketWs

  constructor (node: any, opts: any) {
    super()
  
    this.opts = opts || {}
  
    this._node = node
  
    this.http = new ClientSocketHttp(this.opts.http.port, this.opts.http.ip)
    this.ws = new ClientSocketWs(this._node, this.opts.ws.port, this.opts.ws.ip, this.opts.ws)
  
    if (this.opts.http) {
      this.http.on("listening", (info: any) => {
        this.emit("listening", info)
      })
      this.http.on("resourceSent", (info: any) => {
        this.emit("resourceSent", info)
      })
    }
    if (this.opts.ws) {
      this.ws.on("listening", (info: any) => {
        this.emit("listening", info)
      })
      this.ws.on("resourceSent", (info: any) => {
        this.emit("resourceSent", info)
      })
    }
  }

  listen () {
    if (this.opts.http && !this.listeningHttp) {
      // TODO: check if already listening.
      this.listeningHttp = true
      this.http.listen()
    }
  
    if (this.opts.ws && !this.listeningWs) {
      // TODO check if already listening.
      this.listeningWs = true
      this.ws.listen()
    }
  }

  close () {
    const self = this
  
    Promise.all([_closeHttp(), _closeWs()])
      .then(() => {
        // self.emit("destroyed")
        // self.emit("closed")
      })
  
      function _closeHttp () {
        return new Promise((resolve, reject) => {
          if (self.http && self.listeningHttp) {
            if (self.http.listening) {
              self.http.close().then((info: any) => {
                self.listeningHttp = false
                self.emit("closed", info)
                resolve(info)
              })
            } else {
              self.http.once("listening", (info: any) => {
                if (self.http) self.http.close().then((info: any) => {
                  self.listeningHttp = false
                  self.emit("closed", info)
                  resolve(info)
                })
              })
            }
          } else {
            resolve()
          }
        })
      }
  
      function _closeWs () {
        return new Promise((resolve, reject) => {
          if (self.ws && self.listeningWs) {
            if (self.ws.server.listening) {
              self.ws.close().then((info: any) => {
                self.listeningWs = false
                self.emit("closed", info)
                resolve(info)
              })
            } else {
              self.ws.once("listening", () => {
                if (self.ws) self.ws.close().then((info: any) => {
                  self.listeningWs = false
                  self.emit("closed", info)
                  resolve(info)
                })
              })
            }
          } else {
            resolve()
          }
        })
      }
  }
}

export = ClientSockets