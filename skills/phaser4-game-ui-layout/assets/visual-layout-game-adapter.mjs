/**
 * 项目接入模板：在 host 内启动实际 Phaser 开发 Scene，并返回编辑器所需的窄接口。
 *
 * 将本文件与页面及两个运行模块放在游戏项目的同一开发目录，
 * 再用项目现有启动和 reflow 逻辑替换此函数。
 * nodes 来自已确认的 V2 layout_nodes；targetSha256、sceneId、stateId 必须
 * 与该 V2 产物一致；referenceUrl 指向冻结效果图；getBounds 返回
 * 当前 Scene 的逻辑坐标 bounds；getViewportRect 可返回冻结目标 viewport 在浏览器
 * 页面中的 CSS client rect，供 Camera 缩放和设计视口偏移的坐标映射使用。
 * reflow 必须同步消费 V3 增量配置并调用正式布局入口：各节点以 V2 基准偏移
 * 加自身增量定位，父容器位移由真实层级带动子孙，不对每个子节点重复累加。
 * 编辑器本身不修改 V2 节点或游戏规则。
 *
 * @param {HTMLElement} host 游戏 Canvas 的容器
 * @returns {Promise<{nodes: object[], targetSha256: string, sceneId: string, stateId: string, referenceUrl: string, viewport: {width: number, height: number}, getBounds: (id: string) => object, getViewportRect?: () => object, reflow: (layout: object) => void, destroy?: () => void}>}
 */
export async function createGameEditorAdapter(host) {
  void host;
  throw new Error("请先在游戏项目中接入实际 Phaser Scene、V2 节点和正式布局 reflow 入口");
}
