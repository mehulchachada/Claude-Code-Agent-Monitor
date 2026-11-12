/**
 * @file TurnDigest.tsx
 * @description Digest view for the Conversation tab (v2): a two-pane layout with
 * a searchable turn outline on the left and the detail of the selected turn on
 * the right. On small screens the two panes become a single stack with back
 * navigation.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { filterTurns, type ConversationTurn } from "../../lib/conversation-turns";
import { TurnDetail, type TurnDetailLevel } from "./TurnDetail";
import { TurnOutline } from "./TurnOutline";

/** Props for {@link TurnDigest}. */
interface TurnDigestProps {
  /** All turns, oldest first. */
  turns: ConversationTurn[];
  /** Show a source chip per message (combined view). */
  showSource?: boolean;
  /** True while older history is still being loaded. */
  loadingHistory?: boolean;
}

/**
 * Render the digest view: turn outline + turn detail.
 *
 * @param props - Turns and view options.
 * @returns The digest view.
 */
export function TurnDigest({ turns, showSource = false, loadingHistory = false }: TurnDigestProps) {
  const { t } = useTranslation("sessions");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [level, setLevel] = useState<TurnDetailLevel>("steps");
  const [detailOpen, setDetailOpen] = useState(false);

  // Displayed order is newest first.
  const displayed = useMemo(() => [...filterTurns(turns, query)].reverse(), [turns, query]);

  // The turn on screen: the pinned one while it is still listed, otherwise the
  // newest. It is derived during render, so the detail pane is never blank for a
  // frame, and then pinned so that turns arriving later do not move the selection.
  const selected = displayed.find((turn) => turn.key === selectedKey) ?? displayed[0] ?? null;
  const activeKey = selected?.key ?? null;
  const selectedIndex = selected ? displayed.indexOf(selected) : -1;

  // Turn numbers count from the oldest loaded turn (oldest = 1) over ALL turns,
  // so a turn keeps its number while searching.
  const numbers = useMemo(() => new Map(turns.map((turn, i) => [turn.key, i + 1])), [turns]);

  const selectTurn = (key: string) => {
    setSelectedKey(key);
    setDetailOpen(true);
  };

  const step = (delta: number) => {
    if (selectedIndex === -1) return;
    const next = displayed[selectedIndex + delta];
    if (next) setSelectedKey(next.key);
  };

  return (
    <div
      data-testid="turn-digest"
      className="grid h-full grid-rows-[minmax(0,1fr)] gap-4 lg:grid-cols-[340px_minmax(0,1fr)]"
    >
      <div className={`min-h-0 overflow-y-auto pr-1 ${detailOpen ? "hidden lg:block" : "block"}`}>
        <TurnOutline
          turns={displayed}
          numbers={numbers}
          totalCount={turns.length}
          selectedKey={activeKey}
          onSelect={selectTurn}
          query={query}
          onQueryChange={setQuery}
          loadingHistory={loadingHistory}
        />
      </div>
      <div className={`min-h-0 overflow-y-auto pr-1 ${detailOpen ? "block" : "hidden lg:block"}`}>
        {selected ? (
          <TurnDetail
            turn={selected}
            position={numbers.get(selected.key) ?? 0}
            total={turns.length}
            showSource={showSource}
            level={level}
            onLevelChange={setLevel}
            onNewer={() => step(-1)}
            onOlder={() => step(1)}
            hasNewer={selectedIndex > 0}
            hasOlder={selectedIndex < displayed.length - 1}
            onBack={() => setDetailOpen(false)}
          />
        ) : (
          turns.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-gray-500">{t("detail.transcript.digest.noTurns")}</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
