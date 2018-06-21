import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import StorageSpace from "./storage-space";

const storageDir = "./.tmp/storage";
const dataDir = path.join(storageDir, "data/");
const sizeToAlloc = 100 * 1024 * 1024;

beforeEach(() => {
    rimraf.sync(storageDir);
});

afterEach(() => {
    rimraf.sync(storageDir);
});

it("creates directories", () => {
    expect(fs.existsSync(dataDir)).toBeFalsy();
    const storageSpace = new StorageSpace(storageDir, sizeToAlloc);
    expect(fs.existsSync(dataDir)).toBeTruthy();
});

it("retrieves directories names", () => {
    const storageSpace = new StorageSpace(storageDir, sizeToAlloc);
    expect(storageSpace.dataDir).toBe(dataDir);
});

it("sets and retrieves allocated space", () => {
    const storageSpace = new StorageSpace(storageDir, sizeToAlloc);
    expect(storageSpace.allocated).toBe(sizeToAlloc);
});

it("calculates used space", () => {
    const storageSpace = new StorageSpace("./tests/storage", sizeToAlloc);
    return expect(storageSpace.used()).resolves.toBe(23705340);
});

it("calculates available space", done => {
    const storageSpace = new StorageSpace("./tests/storage", sizeToAlloc);
    const allocated = storageSpace.allocated;
    storageSpace.stats().then((space: any) => {
        expect(space.available > 0 ? space.available : 0).toBe(allocated - space.used);
        done();
    });
});
