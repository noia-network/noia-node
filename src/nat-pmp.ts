import natPmp from "nat-pmp";
import { Client, MappingInfo } from "nat-pmp";
import * as defaultGateway from "default-gateway";

// 2h
export const DEFAULT_TTL = 7200;

export class NatPmp {
    constructor() {
        // TODO: handle gateway errors (for example if v6 interface only available).
        const gateway = defaultGateway.v4.sync().gateway;
        this.client = natPmp.connect(gateway);
    }

    private client: Client;

    public async register(type: string, port: number): Promise<MappingInfo> {
        return new Promise<MappingInfo>((resolve, reject) => {
            this.client.portMapping({ type: type, private: port, public: port, ttl: DEFAULT_TTL }, (err, info) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(info);
            });
        });
    }
}
