# 0x-debug

[![Version](https://img.shields.io/npm/v/0x-debug.svg)](https://npmjs.org/package/0x-debug)
[![Downloads/week](https://img.shields.io/npm/dw/0x-debug.svg)](https://npmjs.org/package/0x-debug)
[![License](https://img.shields.io/npm/l/0x-debug.svg)](https://github.com/dekz/0x-debug/blob/master/package.json)

<!-- toc -->
* [0x-debug](#0x-debug)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->

# Usage

<!-- usage -->
```sh-session
$ npm install -g 0x-relayer-cat
$ 0x-relayer-cat COMMAND
running command...
$ 0x-relayer-cat (-v|--version|version)
0x-relayer-cat/0.0.2 darwin-x64 node-v11.13.0
$ 0x-relayer-cat --help [COMMAND]
USAGE
  $ 0x-relayer-cat COMMAND
...
```
<!-- usagestop -->

# Commands

<!-- commands -->
* [`0x-relayer-cat cat`](#0x-relayer-cat-cat)
* [`0x-relayer-cat help [COMMAND]`](#0x-relayer-cat-help-command)

## `0x-relayer-cat cat`

Call the Ethereum transaction

```
USAGE
  $ 0x-relayer-cat cat

OPTIONS
  -e, --httpEndpoint=httpEndpoint  (required) [default: https://api.radarrelay.com/0x/v2] SRA HTTP endpoint of the
                                   Relayer

  -h, --help                       show CLI help

  -w, --wsEndpoint=wsEndpoint      (required) [default: wss://ws.radarrelay.com/0x/v2] SRA WebSocket endpoint of the
                                   Relayer

  --assetDataA=assetDataA          asset data

  --assetDataB=assetDataB          asset data

  --makerAddress=makerAddress      Maker address

  --toMesh=toMesh                  Mesh Endpoint to forward to

  --toSRA=toSRA                    SRA Endpoint to forward to

EXAMPLE
  $ 0x-relayer-cat cat
```

_See code: [src/commands/cat.ts](https://github.com/dekz/0x-relayer-cat/blob/v0.0.2/src/commands/cat.ts)_

## `0x-relayer-cat help [COMMAND]`

display help for 0x-relayer-cat

```
USAGE
  $ 0x-relayer-cat help [COMMAND]

ARGUMENTS
  COMMAND  command to show help for

OPTIONS
  --all  see all commands in CLI
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v2.1.6/src/commands/help.ts)_
<!-- commandsstop -->
