const ClientSocketHttp = require("./client-socket-http")
const nodeFetch = require("node-fetch")

const ip = "127.0.0.1"
const port = 6767
const address = `http://${ip}:${port}`

it("should listen for http", done => {
  const clientSocketHttp = new ClientSocketHttp(port, ip)
  clientSocketHttp.on("listening", () => {
    nodeFetch(address).then((response: any) => {
      clientSocketHttp.close()
      done()
    })
  })
  clientSocketHttp.listen()
})

it("should exit gracefully", done => {
  const clientSocketHttp = new ClientSocketHttp(port, ip)
  clientSocketHttp.on("listening", () => {
    clientSocketHttp.close()
  })
  clientSocketHttp.on("closed", () => {
    done()
  })
  clientSocketHttp.listen()
})

it("should GET served file", done => {
  const clientSocketHttp = new ClientSocketHttp(port, ip)
  clientSocketHttp.addStaticDirectory("../../tests/http")
  clientSocketHttp.on("listening", () => {
    nodeFetch(`${address}/1111111111111111111111111111111111111111/text-file.json`).then((response: any) => {
      response.json().then((json: any) => {
        expect(json.foo).toBe("bar")
        clientSocketHttp.close().then(() => done())
      })
    })
  })
  clientSocketHttp.listen()
})

it("should emit listening with info", done => {
  const clientSocketHttp = new ClientSocketHttp(port, ip)
  clientSocketHttp.on("listening", (info: any) => {
    expect(info).not.toBeUndefined()
    expect(info.type).toBe("http")
    expect(info.ip).toBe(ip)
    expect(info.port).toBe(port)
    clientSocketHttp.close().then(() => done())
  })
  clientSocketHttp.listen()
})

it("should emit closing with info", done => {
  const clientSocketHttp = new ClientSocketHttp(port, ip)
  clientSocketHttp.on("listening", (info: any) => {
    clientSocketHttp.close()
  })
  clientSocketHttp.on("closed", (info: any) => {
    expect(info).not.toBeUndefined()
    expect(info.type).toBe("http")
    expect(info.ip).toBe(ip)
    expect(info.port).toBe(port)
    done()
  })
  clientSocketHttp.listen()
})

it("closes with info promise", done => {
  const clientSocketHttp = new ClientSocketHttp(port, ip)
  clientSocketHttp.on("listening", (info: any) => {
    clientSocketHttp.close().then((info: any) => {
      expect(info).not.toBeUndefined()
      expect(info.type).toBe("http")
      expect(info.ip).toBe(ip)
      expect(info.port).toBe(port)
      done()
    })
  })
  clientSocketHttp.listen()
})