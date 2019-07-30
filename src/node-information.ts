import * as si from "systeminformation";
import publicIp from "public-ip";
import { Systeminformation } from "systeminformation";

export interface NodeInformation {
    distro?: string;
    arch?: string;
    platform?: string;
    release?: string;
    ipv4?: string;
    ipv6?: string;
    iface?: string;
    ifaceName?: string;
    mac?: string;
    internal?: boolean;
    virtual?: boolean;
    operstate?: string;
    type?: string;
    duplex?: string;
    mtu?: number;
    speed?: number;
    interfacesLength?: number;
}

export interface SystemInformation extends Systeminformation.OsData {
    distro: string;
    arch: string;
    platform: string;
    release: string;
}

export class NodeInfo {
    public async nodeInfo(): Promise<NodeInformation> {
        const dataInfo = await Promise.all([this.osInfo(), this.externalIpv4(), this.externalIpv6()]);

        const systemInfo = dataInfo[0];
        const externalIp4 = dataInfo[1];
        const externalIp6 = dataInfo[2];

        const nodeInformation: NodeInformation = {};

        if (systemInfo != null) {
            nodeInformation.distro = systemInfo.distro;
            nodeInformation.arch = systemInfo.arch;
            nodeInformation.release = systemInfo.release;
            nodeInformation.platform = systemInfo.platform;
        }

        if (externalIp4 != null) {
            nodeInformation.ipv4 = externalIp4;
        }
        if (externalIp6 != null) {
            nodeInformation.ipv6 = externalIp6;
        }

        return nodeInformation;
    }

    public async externalIpv4(): Promise<string | null> {
        try {
            const ipv4 = await publicIp.v4({ timeout: 1000 });
            return ipv4;
        } catch (err) {
            return null;
        }
    }

    public async externalIpv6(): Promise<string | null> {
        try {
            const ipv6 = await publicIp.v6({ timeout: 1000 });
            return ipv6;
        } catch (err) {
            return null;
        }
    }

    public async osInfo(): Promise<SystemInformation | null> {
        try {
            const data = await si.osInfo();
            return data;
        } catch (err) {
            return null;
        }
    }

    public async allNetworkInterfaces(): Promise<Systeminformation.NetworkInterfacesData[] | null> {
        try {
            const data = await si.networkInterfaces();
            return data;
        } catch (error) {
            return null;
        }
    }
}
