# MusicFree · Meting 自建源插件

适用于 [MusicFree](https://github.com/maotoumao/MusicFree) 的聚合音源插件，以你**自建的 MetingAPI（metowolf / Hono 版）** 为主音源，支持网易云 / QQ / 酷狗 / 百度 / 酷我等多平台搜索、播放、歌词、歌单。

## 功能

- **搜索（开箱即搜）**：以「网易云官方搜索接口」为主力保底源（高可用、不依赖第三方实例），公共 MetingAPI 实例池补充 QQ / 酷狗 / 百度 / 酷我；多源并发、合并去重。未填 `apiBase` 也能直接搜到网易云歌曲
- **播放 / 歌词 / 歌单 / 专辑**：完整媒体链路
- **榜单 & 推荐歌单**：内置网易云官方榜单 11 个（飙升 / 新歌 / 热歌 / 原创 / 说唱 / 古典 / 电音 / 摇滚 / 抖音 / 韩语 / ACG），均带**真实封面图**，并作为推荐歌单展示，免鉴权即可看榜（MetingAPI 无个性化推荐 feed，官方榜单即最稳妥的推荐来源）
- **HMAC-SHA1 鉴权**：对取链 / 歌词等敏感接口自动签名，与服务端 `METING_TOKEN` 共用密钥
- **容灾兜底**：主音源（你的 Vercel）不可用时，自动回退到 `api.injahow.cn`（播放 / 歌词 / 歌单 / 榜单）
- **可自动更新**：通过 `srcUrl` 一键更新

## 安装

在 MusicFree 中：

1. 左上角菜单 → **插件设置** → 右下角 **+** → **从网络安装插件**
2. 粘贴本仓库的 raw 地址（即插件元数据的 `srcUrl`）：

   ```
   https://raw.githubusercontent.com/<你的用户名>/musicfree-meting-plugin/main/meting-free.js
   ```

3. 安装后，在 **插件设置 → 用户变量** 中填写：
   - `apiBase`：你的 MetingAPI 地址，例如 `https://my-meting.vercel.app`（不要结尾斜杠）
   - `token`：与 MetingAPI 服务端 `METING_TOKEN` **完全一致** 的随机串

> 不填 `apiBase` 也能**直接搜索（网易云官方接口）+ 看榜 + 播放**（播放 / 歌词 / 榜单走 injahow 兜底）。填了自建 Vercel 地址后 QQ / 酷狗 / 百度 / 酷我 全平台更全更稳，且取链带 HMAC 鉴权更安全。

## 自建 MetingAPI（推荐，让搜索稳定可控）

详见同仓库的 **[VERCEL_DEPLOY.md](./VERCEL_DEPLOY.md)** —— 用 Vercel 免费托管 `metowolf/Meting-API`，三步拿到你自己的音源地址，搜索再也不依赖任何公共实例。

## 更新

插件设置中点击「更新插件」即可从 `srcUrl` 拉取最新版；或重新执行「从网络安装」。

## 安全与合规

- 本插件仅做「请求转发 + 格式转换」，不收集任何个人信息。
- 曲库来自你配置（或兜底）的第三方 MetingAPI 实例，请合理合规使用，尊重平台版权。
- 代码完全开源，可自行审计。

## 文件

- `meting-free.js` — 插件本体
- `VERCEL_DEPLOY.md` — 自建 MetingAPI 部署清单
