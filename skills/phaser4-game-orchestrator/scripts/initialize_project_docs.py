#!/usr/bin/env python3
"""初始化 Phaser 4 游戏项目的中文交接文档。"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


TEMPLATES = {
    "project-profile.yaml": """# 项目配置是角色协作的机器可读事实来源。
project:
  名称: 待定
  当前阶段: 立项
  版本: 0.1.0
channels:
  mini_game: 待决策
  ios: 待决策
  google_play: 待决策
  other: 待决策
capabilities:
  登录: 待决策
  云存档: 待决策
  内购: 待决策
  广告: 待决策
  埋点: 待决策
  推送: 待决策
  排行榜: 待决策
  联机: 待决策
quality_targets:
  目标设备: 待人工指定
  帧率: 待人工指定
  冷启动时间: 待人工指定
  包体上限: 待人工指定
  离线策略: 待人工指定
""",
    "GDD.md": """# 游戏设计文档

## 一句话定义

待人工定义。

## 玩家与核心循环

待人工定义：目标玩家、操作方式、目标、反馈、失败与重试。

## 最小可交付范围

待人工批准。

## 功能验收条件

| 功能 | 玩家行为 | 可观察结果 | 负责人 | 状态 |
| --- | --- | --- | --- | --- |

## 明确排除项

待人工定义。
""",
    "TDD.md": """# 技术设计文档

## 技术基线

- 游戏：Phaser 4 + TypeScript + Vite
- 原生容器：Capacitor
- 渠道适配：小游戏、iOS、Google Play 分别评估

## 模块边界

待技术架构角色补充：场景、状态、输入、资源、存档、平台与可选商业服务。

## 构建与运行

待技术架构角色记录可复现命令、版本和环境要求。

## 风险与待决策

待补充。
""",
    "balance.md": """# 数值设计

## 设计目标与玩家节奏

待数值设计角色补充。

## 参数与公式

| 参数 | 含义 | 默认值 | 来源 | 调整影响 | 验证方式 |
| --- | --- | --- | --- | --- | --- |

## 模拟与实测记录

待补充。
""",
    "asset-license-register.md": """# 资源与授权登记

| 资源 | 类型 | 用途 | 来源 | 授权/生成记录 | 发布可用 | 优化状态 |
| --- | --- | --- | --- | --- | --- | --- |

## 替换计划

临时资源必须标注替换负责人和截止质量门。
""",
    "qa-plan.md": """# 测试与性能计划

## 缺陷分级

- P0：无法启动、数据丢失、合规阻断或核心流程不可完成。
- P1：关键体验或目标渠道功能不可接受。
- P2：可绕过的功能或体验问题。
- P3：非阻断的优化项。

## 设备与性能矩阵

目标设备和指标待人工指定；未指定前不得判定性能达标。

| 渠道/设备 | 版本 | 测试项 | 帧率 | 启动时间 | 内存/包体 | 结果 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
""",
    "platform-matrix.md": """# 平台矩阵

| 渠道 | 优先级 | 打包方式 | 必要适配 | 商店/平台资料 | 合规状态 | 负责人 |
| --- | --- | --- | --- | --- | --- | --- |
| 小游戏 | 首批 | 待评估 | 待评估 | 待评估 | 待评估 | 发布合规 |
| iOS | 首批 | Capacitor | 待评估 | 待评估 | 待评估 | 发布合规 |
| Google Play | 首批 | Capacitor | 待评估 | 待评估 | 待评估 | 发布合规 |
| 其他 | 扩展 | 待评估 | 待评估 | 待评估 | 待评估 | 发布合规 |
""",
    "G0-人工决策请求.md": """# G0 人工决策请求

## 状态

未批准。仅当具名人工决策人完成结论和日期后，项目才可进入 G1。

| 议题 | 可选项与影响 | 推荐项 | 最迟决策点 | 决策人 | 结论 | 日期 |
| --- | --- | --- | --- | --- | --- | --- |
| 核心循环与最小范围 | 待制作策划补充 | 待制作策划补充 | G0 通过前 | 待指定 | 待人工决定 |  |
| 首发渠道与小游戏平台 | 待技术架构补充 | 待技术架构补充 | G0 通过前 | 待指定 | 待人工决定 |  |
| 商业能力开关 | 待制作策划补充 | 待制作策划补充 | G0 通过前 | 待指定 | 待人工决定 |  |
| 资源权属路径 | 待美术与音频补充 | 待美术与音频补充 | G0 通过前 | 待指定 | 待人工决定 |  |
| 质量指标与责任人 | 待测试性能补充 | 待测试性能补充 | G1 开始前 | 待指定 | 待人工决定 |  |
""",
    "grilling-log.md": """# 拷问记录

只有人工明确确认“已达成共同理解”或等效结论后，记录才可作为需求、计划或发布状态的变更依据。

| 日期 | 阶段 | 触发原因 | 已核实事实 | 问题 | 用户回答 | 推荐项 | 共同理解确认 | 影响文档/角色 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
""",
    "worktree-plan.md": """# Worktree 收敛计划

仅将工作目录干净、已完成必要检查、没有待人工决策且已更新交接状态的分支标为待收敛。总控将依此自动合并并清理本地 worktree 与分支。

| 批次 | 分支 | Worktree 目录 | 范围 | 检查证据 | 提交 | 状态 | 阻断原因 |
| --- | --- | --- | --- | --- | --- | --- |
""",
    "release-checklist.md": """# 发布检查清单

## 发布候选版本

- 版本号：
- 构建提交：
- 构建命令：
- 候选包位置：

## 必须核验

- [ ] 人工已批准 G3。
- [ ] 每个目标渠道都有对应候选包和测试证据。
- [ ] 商店资料、隐私声明、分级和资源授权已核验。
- [ ] 没有密钥或商店凭据进入仓库。
- [ ] 已知风险、回滚或热修复方案已记录。
""",
    "decision-log.md": """# 决策日志

| 编号 | 议题 | 可选项与影响 | 推荐项 | 决策人 | 截止时间 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
""",
    "handoff-status.md": """# 角色交接状态

| 角色 | 输入 | 输出 | 状态 | 阻塞/待决策 | 证据 | 下游确认 |
| --- | --- | --- | --- | --- | --- | --- |
| 制作策划 | 项目意图 | GDD、决策日志 | 未开始 |  |  |  |
| 技术架构 | GDD、渠道 | TDD、项目骨架 | 未开始 |  |  |  |
| 玩法开发 | GDD、TDD、数值 | 玩法实现 | 未开始 |  |  |  |
| 数值设计 | GDD | balance.md | 未开始 |  |  |  |
| 美术接入 | GDD、TDD | 资源与授权登记 | 未开始 |  |  |  |
| 音频设计 | GDD、TDD | 音频方案与授权登记 | 未开始 |  |  |  |
| 测试性能 | 全部交接物 | qa-plan.md、测试证据 | 未开始 |  |  |  |
| 发布合规 | 候选包、资源登记 | 平台矩阵、发布清单 | 未开始 |  |  |  |
""",
}


def parse_args() -> argparse.Namespace:
    """解析显式项目目录与覆盖授权，避免向未知位置写入文件。"""
    parser = argparse.ArgumentParser(description="初始化 Phaser 4 游戏协作文档")
    parser.add_argument("--project-root", required=True, type=Path, help="目标游戏项目根目录")
    parser.add_argument("--force", action="store_true", help="明确覆盖本脚本管理的同名文档")
    return parser.parse_args()


def validate_project_root(project_root: Path) -> Path:
    """拒绝文件系统根目录，降低误写入过宽目录的风险。"""
    resolved = project_root.resolve()
    if resolved == resolved.parent:
        raise ValueError("项目目录不能是文件系统根目录。")
    return resolved


def initialize_documents(project_root: Path, force: bool) -> list[Path]:
    """仅创建或显式覆盖 docs 下的标准交接物，并返回写入清单。"""
    docs_dir = project_root / "docs"
    targets = [docs_dir / filename for filename in TEMPLATES]
    existing = [path for path in targets if path.exists()]
    if existing and not force:
        names = "、".join(path.name for path in existing)
        raise FileExistsError(f"拒绝覆盖已有文档：{names}。如确需覆盖，请显式传入 --force。")

    docs_dir.mkdir(parents=True, exist_ok=True)
    for path in targets:
        path.write_text(TEMPLATES[path.name], encoding="utf-8")
    return targets


def main() -> int:
    """执行初始化并输出可审计的写入结果。"""
    args = parse_args()
    try:
        project_root = validate_project_root(args.project_root)
        written = initialize_documents(project_root, args.force)
    except (OSError, ValueError) as error:
        print(f"初始化失败：{error}", file=sys.stderr)
        return 1

    print("已初始化项目交接物：")
    for path in written:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
