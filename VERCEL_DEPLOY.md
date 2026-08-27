# MusicFree 自建 MetingAPI（Vercel）部署清单

> 目标：把 `meting-free.js` 插件的主音源指向你**自己部署的 MetingAPI（Hono 版）**，
> 实现「曲库全 + 稳定 + 可控 + 可自动更新」。
> 架构：主音源 = 你的 Vercel 实例；兜底 = `api.injahow.cn`（仅播放/歌词/歌单）。

---

## 第 0 步：准备（1 分钟）

1. 注册/登录 **GitHub**（用 GitHub 账号即可，后面 Vercel 也用它登录）。
2. 注册 **Vercel**（https://vercel.com ，用 GitHub 登录，免费 Hobby 版足够）。
3. 准备一段随机字符串当 `METING_TOKEN`（服务端和插件共用，**必须一模一样**）：

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

   复制输出，后面要用两次。

---

## 第 1 步：Fork 仓库（GitHub）

1. 打开 https://github.com/metowolf/Meting-API
2. 点右上角 **Fork** → 一路默认 → **Create fork**
   （fork 到自己账号，方便以后同步上游更新）

---

## 第 2 步：导入 Vercel（网页点几下）

1. 打开 https://vercel.com/new
2. **Import Git Repository** → 选你刚 fork 的 `Meting-API`
3. 框架一般自动识别（Node/Hono），**无需改构建命令**；若要求手动设置：
   - Framework Preset：`Other`
   - Build Command：留空或 `yarn build`
   - Output：默认
4. 先**不要急着 Deploy**，先设环境变量（见第 3 步）；或直接 Deploy 后再补也可以。

---

## 第 3 步：设置环境变量（关键）

在 Vercel 项目 **Settings → Environment Variables** 新增：

| 变量名 | 值 | 说明 |
|---|---|---|
| `METING_TOKEN` | 第 0 步生成的随机串 | HMAC 签名密钥，**必填** |
| `METING_URL` | 你的 Vercel 域名 | 见第 4 步；先用占位也行，部署后再改 |

> 选 Environment：`Production`（默认即可）。

---

## 第 4 步：部署 & 回填域名

1. 点 **Deploy**。等 1~2 分钟，出现 `Your project has been deployed`。
2. 记下分配给你的域名，形如 `https://meting-api-xxx.vercel.app`
   （在项目首页顶部「Domains」或「Visit」处可见）。
3. 回到 **Settings → Environment Variables**，把 `METING_URL` 改成这个真实域名
   （例如 `https://meting-api-xxx.vercel.app`）。
4. 改完点 **Redeploy**（或重新触发一次部署）让环境变量生效。

✅ 验证：浏览器访问 `https://你的域名/api?server=netease&type=search&id=周杰伦`
看到 JSON 歌曲数组 = 部署成功。

---

## 第 5 步：插件里填写（MusicFree）

1. 把 `meting-free.js` 传到手机，MusicFree → 左上角菜单 → **插件设置** → **本地导入**。
2. 导入后点该插件 → **用户变量**，填两项：

   | 变量 | 值 |
   |---|---|
   | `apiBase` | 你的 Vercel 域名，**不要带 `/api`**，如 `https://meting-api-xxx.vercel.app` |
   | `token` | 和第 0 步、Vercel 里**完全一致**的那串随机字符 |

3. 返回搜索框搜歌，应能出结果；点开播放 → 走你自己的服务。

> 若 `apiBase` 留空 → 搜索不可用（这是设计使然，主音源必须自建）。

---

## 第 6 步（可选）：提音质 / 拿完整数据

部分平台需要登录态 Cookie。在 Vercel 环境变量加（值从对应平台网页抓包获得）：

- `METING_COOKIE_NETEASE` 网易云
- `METING_COOKIE_TENCENT` QQ音乐
- `METING_COOKIE_KUGOU` 酷狗

加完 Redeploy 生效。

---

## 自动更新插件（可选但推荐）

1. 把 `meting-free.js` 上传到你的 GitHub 仓库（任意公开仓库）。
2. 复制它的 raw 链接，形如
   `https://raw.githubusercontent.com/你的名/仓库/main/meting-free.js`
3. 在插件属性里把 **srcUrl** 设成这个链接。
   以后作者更新 → 插件设置里点「更新插件」即可拉新版（服务器你自己管，无需动）。

---

## 排错

| 现象 | 原因 / 解决 |
|---|---|
| 搜索没结果 | `apiBase` 没填或填错（多了 `/api`、域名不对） |
| 能搜但不能播放 / 401 | `token` 与 Vercel 的 `METING_TOKEN` **不一致**，或 `METING_URL` 与部署域名不符 |
| 播放偶发超时 | Vercel 免费版函数约 10s 上限，冷启动+上游慢会超时，重试即可；量大建议换 VPS/Docker |
| injahow 兜底生效 | 主音源失败时自动回退，属正常容灾；想纯自托管可不管 |
