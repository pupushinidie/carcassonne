import { useEffect, useState } from "react";

/** 规则说明：一个按钮，点开是像素弹窗。用自己的话写，不照搬原版规则书。 */
function GameRules({ className = "quiet-button" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className={`${className} kd-rules-button`} type="button" aria-expanded={open} onClick={() => setOpen(true)}>规则</button>
      {open && (
        <div className="gm-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section className="gm-panel kd-rules" role="dialog" aria-modal="true" aria-labelledby="kd-rules-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="kd-rules-title">卡卡颂怎么玩</h2>
            <div className="game-rules-block">
              <h3>目标</h3>
              <p>
                大家轮流抽地块，一起拼一张越来越大的地图。放下地块后可以在上面放一个<b>小人</b>占住一条路、一座城、一座修道院或一片草地；
                这些地方<b>完工</b>时占着它的人得分，小人回到手里。牌堆用完后再结算一次，总分最高的赢（同分就一起赢）。
              </p>
            </div>
            <div className="game-rules-block">
              <h3>轮到你时</h3>
              <ol>
                <li><b>放地块</b>（必做）：要和已有地块上下或左右挨着，相接的边要同类：城接城、路接路、草地接草地。可以转方向，确认后不能撤回。</li>
                <li><b>放小人</b>（可以不放）：只能放在刚放的这块上。连起来的整条路 / 整座城 / 整片草地里<b>已经有小人</b>（谁的都算）就不能再放。每人 7 个。</li>
                <li><b>结算</b>（自动）：因为这块完工的路、城、修道院马上计分，上面的小人回到手里。别人帮你封口也算你的。</li>
              </ol>
            </div>
            <div className="game-rules-block">
              <h3>计分</h3>
              <ul>
                <li><b>路</b>：两头都到头（接进城、路口、修道院，或绕成环）算完工，每块 1 分。</li>
                <li><b>城</b>：城墙围死算完工，每块 2 分，每个盾徽再加 2 分。</li>
                <li><b>修道院</b>：周围 8 格都放满算完工，9 分。</li>
                <li>一处有好几个人的小人（两片被连在了一起）：小人最多的人拿全部分，一样多就都拿全分。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>游戏结束</h3>
              <ul>
                <li>没完工的路每块 1 分；没完工的城每块 1 分、盾徽 1 分；没完工的修道院 1 分 + 周围已有的块数。</li>
                <li><b>农夫</b>（躺着的小人，房主可以关）：整局收不回来；终局时他那片草地挨着几座<b>完工的城</b>，就得 3 × 几分。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>本站的约定</h3>
              <ul>
                <li>抽到哪里都放不下的地块，会自动移出本局、再抽一块，会有提示。</li>
                <li>放地块 90 秒、放小人 30 秒，超时自动替你放在第一个能放的位置、不放小人；连续超时 2 次转托管（人机代打），掉线时也由人机代打，回来能接上。</li>
                <li>别人试着摆地块时，你能看到他在试哪里（虚线框）。</li>
              </ul>
            </div>
            <div className="gm-panel-actions">
              <button className="primary-button" type="button" onClick={() => setOpen(false)}>知道了</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default GameRules;
