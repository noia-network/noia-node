// // import StorageSpace from "./storage-space";
// import { ContentsClient } from "@noia-network/node-contents-client";

// const storageDir = "tests/storage";
// // const dataDir = "tests/storage/data";
// // const metadataPath = "tests/storage/metadata.json";
// const infoHashes = ["f8f40a6b918314b6ec7cb71d487aec1d529b163b"];

// it("should discovers storage and seeds contents", done => {
//     // const storageSpace = new StorageSpace("tests/storage", 1048576);
//     const contentsClient = new ContentsClient(null, storageDir);
//     contentsClient.on("seeding", (data: any) => {
//         if (data.length === 1) {
//             expect(data).toEqual(expect.arrayContaining(infoHashes));
//             contentsClient.destroy().then(done);
//         }
//     });
//     contentsClient.start();
// });
