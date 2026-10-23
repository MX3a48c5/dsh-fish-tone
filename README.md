# dsh-fish-tone

两个 [DSH](https://github.com/deepseek-ai) 插件，放一个仓库里。

| 包 | 干什么 | 默认 |
|---|---|---|
| [`packages/dsh-fish-tone`](packages/dsh-fish-tone) | **人味插件**：把话往人的方向掰一点点。犹豫半秒、句尾挂个没用的小尾巴、带一份「无用度」统计 | 开 |
| [`packages/dsh-fish-tone-flavor`](packages/dsh-fish-tone-flavor) | **性格附属包**：可爱 / 抽象 / 热梗，77 条梗 + 24 个句式 | 关 |

主包只管「像人说话」这件事。性格是偏好，不是语言能力，所以拆出去了：**不装附属包，主包一个字都不变**。

## 装

```sh
dsh plugin --profile web add link:./packages/dsh-fish-tone

# 想要性格层再装这个
dsh plugin --profile web add link:./packages/dsh-fish-tone-flavor
```

装完**重启一次 dsh**（宿主半端和设置页是启动时装配的，Node 的 ESM 缓存不吃热更新）。

## 用

装好后聊天里就有 `fish_tone` / `fish_grammar`（附属包装上还有 `fish_meme` / `fish_flavor`），
系统提示里会多一节「说话的松紧」。设置页在 **设置 → 人味插件**。

```js
fish_tone({ text: "……" })                    // 轻掰一档
fish_tone({ text: "……", strength: "max" })    // 会塞一句废话
fish_grammar({ text: "……" })                  // 只报语病，不改
```

## 测试

```sh
npm test      # 81 个：主包 62 + 附属包 19
```

## 许可

MIT。方法来自 [BV1BNnc6nEUa](https://www.bilibili.com/video/BV1BNnc6nEUa)，
语料是 B 站公开的评论与弹幕，报告里只有聚合统计，没有别人的原话。
