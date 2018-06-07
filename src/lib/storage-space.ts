import fs from "fs"
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
    return getSize(this.storageDir)
  }
   
  // based on https://stackoverflow.com/a/34017887
  stats () {
    return new Promise((resolve) => {
      getSize(this.storageDir)
        .then((size) => {
          return resolve(size - fs.statSync(this.metadataPath).size)
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
      fs.readdir(directory, (err: Error, files) => {
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

function getSize (dirPath: any) {      
  return getStat(dirPath).then((stat: any) => {  
    if (stat.isFile()) { // if file return size directly
      return stat.size
    } else {
      return getFiles(dirPath).then((files: any) => { // getting list of inner files
        var promises = files.map((file: any) => {
          return path.join(dirPath, file)  
        }).map(getSize) // recursively getting size of each file
        return Promise.all(promises)   
      }).then((childElementSizes) => { // success callback once all the promise are fullfiled i. e size is collected 
          var dirSize = 0
          childElementSizes.forEach((size: any) => { // iterate through array and sum things
              dirSize += size
          })
          return dirSize
      })
    }    
  })
}

// promisified get stats method
function getStat (filePath: any) {
  return new Promise((resolve, reject) => {
    fs.lstat(filePath, (err: Error, stat) => {
      if (err) return reject(err)
      resolve(stat)
    })
  })
}

// promisified get files method
function getFiles (dir: string) {
  return new Promise((resolve, reject) => {
    fs.readdir(dir, (err: Error, stat) => {
      if(err) return reject(err)
      resolve(stat)
    })
  })
}

export = StorageSpace