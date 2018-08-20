import speedTest from "speedtest-net";

export namespace Helpers {
    export function getSpeedTest(): Promise<any> {
        // TODO: <Data | Error> instead of <any>.
        return new Promise<any>((resolve, reject) => {
            const test = speedTest({
                maxTime: 20000
            });
            test.on("data", data => {
                resolve(data);
            });
            test.on("error", (error: Error) => {
                reject(error);
            });
        });
    }
}
