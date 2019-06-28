import { Command, flags } from '@oclif/command';

import { HttpClient, ordersChannelFactory, OrdersChannelHandler, SignedOrder } from '@0x/connect';
import * as _ from 'lodash';

export class Cat extends Command {
    public static description = 'Call the Ethereum transaction';
    private _toSRAEndpoint!: HttpClient;

    public static examples = [`$ 0x-relayer-cat cat`];

    public static flags = {
        help: flags.help({ char: 'h' }),
        httpEndpoint: flags.string({
            char: 'e',
            description: 'SRA HTTP endpoint of the Relayer',
            default: 'https://api.radarrelay.com/0x/v2',
            required: true,
        }),
        wsEndpoint: flags.string({
            char: 'w',
            description: 'SRA WebSocket endpoint of the Relayer',
            default: 'wss://ws.radarrelay.com/0x/v2',
            required: true,
        }),
        assetDataA: flags.string({
            description: 'asset data',
        }),
        assetDataB: flags.string({
            description: 'asset data',
        }),
        makerAddress: flags.string({
            description: 'Maker address',
        }),
        toSRA: flags.string({
            description: 'SRA Endpoint to forward to',
        }),
        toMesh: flags.string({
            description: 'Mesh Endpoint to forward to',
        }),
    };

    public static args = [];
    private ordersReceived(orders: SignedOrder[]): void {
        const { flags } = this.parse(Cat);
        const { makerAddress } = flags;
        const filteredOrders = makerAddress
            ? orders.filter(o => o.makerAddress === makerAddress.toLowerCase())
            : orders;
        if (flags.toSRA) {
            for (const order of filteredOrders) {
                void this._toSRAEndpoint.submitOrderAsync(order);
            }
        } else {
            for (const order of filteredOrders) {
                console.log(JSON.stringify(order));
            }
        }
    }

    private async connect(
        httpEndpoint: string,
        wsEndpoint: string,
        assetDataA?: string,
        assetDataB?: string,
    ): Promise<void> {
        const client = new HttpClient(httpEndpoint as any);
        const allAssetPairs = await client.getAssetPairsAsync({ perPage: 500 });
        const filteredAssetPairs = allAssetPairs.records.filter(pair => {
            if (assetDataA && assetDataB) {
                return (
                    _.includes([pair.assetDataA.assetData, pair.assetDataB.assetData], assetDataA) &&
                    _.includes([pair.assetDataA.assetData, pair.assetDataB.assetData], assetDataB)
                );
            } else if (assetDataA) {
                return _.includes([pair.assetDataA.assetData, pair.assetDataB.assetData], assetDataA);
            }
            return true;
        });
        const ordersChannelHandler: OrdersChannelHandler = {
            onUpdate: async (_channel, _opts, apiOrders) => {
                const orders = apiOrders.map(o => o.order);
                this.ordersReceived(orders);
            },
            onError: () => {},
            onClose: () => {
                console.error('Channel closed');
                process.exit(1);
            },
        };
        const ordersChannel = await ordersChannelFactory.createWebSocketOrdersChannelAsync(
            wsEndpoint as any,
            ordersChannelHandler,
        );
        for (const pair of filteredAssetPairs) {
            const orderBook = await client.getOrderbookAsync({
                baseAssetData: pair.assetDataA.assetData,
                quoteAssetData: pair.assetDataB.assetData,
            });
            const orders = _.merge(orderBook.asks.records, orderBook.bids.records).map(o => o.order);
            this.ordersReceived(orders);
            ordersChannel.subscribe({
                baseAssetData: pair.assetDataA.assetData,
                quoteAssetData: pair.assetDataB.assetData,
                limit: 1000,
            });
        }
    }

    // tslint:disable-next-line:async-suffix
    public async run(): Promise<void> {
        const { args, flags } = this.parse(Cat);
        const { httpEndpoint, wsEndpoint, assetDataA, assetDataB } = flags;
        if (flags.toSRA) {
            this._toSRAEndpoint = new HttpClient(flags.toSRA);
        }
        this.connect(httpEndpoint, wsEndpoint, assetDataA, assetDataB);
    }
}
