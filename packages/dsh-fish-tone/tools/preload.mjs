// 测试不要读用户自己的 config.json / debug.log。
// 设置页里把档位改成 max，测试就会因为「默认应该是 light」而红 —— 那不是 bug。
// 用 --import 先跑这个文件，把两个路径都指到临时文件上。
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'

const cfg = join(tmpdir(), `dsh-fish-tone-test-${process.pid}.json`)
const log = join(tmpdir(), `dsh-fish-tone-test-${process.pid}.log`)
for (const p of [cfg, log]) rmSync(p, { force: true })

process.env.DSH_FISH_TONE_CONFIG = cfg
process.env.DSH_FISH_TONE_LOG = log
