# Agent Note: Web 设置「通用」分区版本行

Status: implemented

[English](2026-08-18-web-settings-version-row.md) | 中文

## 问题

Web GUI 没有任何版本展示。对反复同步、重建、重启（从 checkout 跑 `dsh web`，或安装的 `dsh`）的操作者来说，页面本身无法说明当前服务的是哪个构建——唯一的事实来源是拿到 shell 跑 `dsh --version`。而展示版本并不是纯客户端改动：每个客户端包各自构建为独立 bundle，跨插件值导入是构建错误（客户端 bundle 纯度门），所以展示需要一个宿主→浏览器通道，外加行组件可读的服务面。

## 决策

为这一个宿主事实完整复用 LAN 信任栅栏的模式：

- `dsh-web-app` 的运行时粘合在服务页面 `<head>` 里、信任栅栏旁拼接第二段内联脚本：`window.__DSH_WEB_VERSION__` 携带本包 `package.json` 的版本（`src/index.ts` 以与 `apps/cli/src/bin.ts` 相同的 checked-in manifest 惯用法读取）。dsh 家族按同一节奏发布，因此该字符串就是服务中的 `dsh` 发布版本——与 `dsh --version` 输出一致。head 拼接抽为两处注入共用的辅助函数。
- `dsh-client-connection` 持有全局名（`src/web-version.ts`，与 `web-trust.ts` 并列，从两个导出面导出），浏览器客户端在 boot 时把它镜像为 `ConnectionHandle.webVersion`——跨插件协作走服务，绝不做值导入。
- `dsh-client-ui-settings-general`——不属于任何单一功能的设置文案的所有者——在「通用」分区的 `settings.general.item` slot 注册只读的「版本」行（id `version`，order 30，排在权限／语言／外观／Composer 之后）。注册以镜像存在为前提，与仅限回环的配置文件操作同一姿态：Web 宿主未服务过的上下文（组件测试装置、非浏览器测试）不显示该行。

## 备选方案

- **构建期把版本烘焙进客户端 bundle。** 否决：每个客户端包都是独立编号的 bundle，各自会显示自己的包版本而非服务中的发布版本，且 shell 与客户端行要经过两条构建管线来喂同一个字符串。
- **给 `__DSH_WEB_TRUST__` 扩一个版本字段。** 否决：信任栅栏是带权限匹配语义的安全契约；产品版本是展示元数据，读者与生命周期都不同。
- **给 boot graph（`WebBootGraph`）加版本字段。** 否决：那条 wire 为模块到达服务；产品元数据会搭上装载机制，还要为同一个字符串新增客户端访问器。
- **侧边栏脚部常驻版本行。** 由操作者选择搁置：优先「通用」分区行；脚部座位的 slot 管道未搭建。

## 后果

- 设置 → 通用设置 末尾出现只读版本行，其值等于服务进程的 `dsh --version`；两者以同样方式读取 checked-in 的 `package.json`。
- 该值是发布字符串而非提交：checkout 在未 bump 发布的合并后重建，仍显示上一次 bump 的版本。这对齐 lockstep 发布节奏，也与同一棵树上任何 `dsh --version` 的回答一致。
- `window.__DSH_WEB_VERSION__` 加入页面注入全局面（`__DSH_BOOT__`、`__DSH_WEB_TRUST__`）；它是公开的展示数据，不是信任输入。
- 设置对话框的浏览器 e2e golden 收录该行，值按行自身标签锚定归一为 `{{version}}`，golden 不随发布变动。
