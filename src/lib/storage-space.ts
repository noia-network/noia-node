import fs from "fs";
const getFolderSize = require("get-folder-size") // actual size, not on disk
const logger = require("./logger")
const mkdirp = require("mkdirp")
const path = require("path")
const rimraf = require("rimraf")

class StorageSpace {
  public allocated: any
  public storageDir: any
  public dataDir: any
  public metadataPath: any

  constructor (storageDir: any, storageAllocated: any) {
    const self = this
  
    if (!(self instanceof StorageSpace)) return new StorageSpace(storageDir, storageAllocated)
  
    if (!storageDir) throw new Error("unspecified storageDir")
    if (!storageAllocated) throw new Error("unspecified storageAllocated")
  
    self.allocated = storageAllocated
    self.storageDir = path.resolve(storageDir)
    self.metadataPath = path.join(storageDir, "metadata.json")
  }

  total () {
    const self = this
  
    return self.allocated
  }

  // TODO: unused?
  used () {
    const self = this
  
    return new Promise((resolve, reject) => {
      getFolderSize(self.storageDir, (err: any, size: any) => {
        if (err) return reject(new Error(err))
        resolve(size)
      })
    })
  }

  stats () {
    const self = this
  
    return new Promise((resolve, reject) => {
      getFolderSize(self.storageDir, (err: any, size: any) => {
        if (err) return reject(new Error(err))
        const leftBytes = self.allocated - size
        const available = leftBytes > 0 ? leftBytes : 0
        const used = size
        const total = self.allocated
        resolve({
          total,
          available,
          // exclude block size and metadata size not to confuse users
          used: used - fs.statSync(self.storageDir).blksize - fs.statSync(self.metadataPath).size
        })
      })
    })
  }
  
  reserved () {
    throw new Error("not implemented")
    // space required for contents in download state
  }
  
  clear () {
    const self = this
  
    const dirs = [ self.dataDir ]
    function clearDir (directory: any) {
      fs.readdir(directory, (err, files) => {
        if (err) throw err
        for (const file of files) {
          rimraf.sync(path.join(directory, file))
        }
        logger.info(`Removed from ${directory}`, files)
      })
    }
    dirs.forEach((dir) => {
      clearDir(path.join(self.storageDir, dir))
    })
  }
}

export = StorageSpace