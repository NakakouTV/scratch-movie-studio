# 説明の節目と音声の目印

独立カットを「対象を見る → 操作を見る → 結果を読む」という区切りで設計できます。区切りを`beats`、操作途中の節目を`cues`として指定します。総時間の一致だけで操作を先行させず、音声の言葉へ操作開始を結び付けるための機能です。

`/cuts.html`の「説明の節目・音声の目印」から、変数名と対象を選んで設定を生成できます。コスチューム名2つの比較設定も生成できます。設定JSONで時刻・速度・確認時間を編集してください。

## 音声の時刻を渡す

音声作成・音声認識・単語時刻の自動推定は含みません。音声編集や音声生成側で確定した目印を、JSONで入力します。台本から操作列を自動的に作るAIエージェントも含みません。

```json
"narration": {
  "markers": [
    {"id":"show-definition","text":"この定義","atMs":3000},
    {"id":"four","text":"4にします","atMs":8000}
  ]
}
```

atMsは**完成カット先頭を0msとする時刻**です。beforeMsの前余白も含みます。音声は編集時に同じ0秒へ合わせて配置します。音声ファイルはこの機能ではミックスせず、従来どおりScratch実行音を出力します。画面の「目印JSONを取り込む」は上のmarkers配列、または`{"markers":[...]}`を読み込みます。

操作の`cues`で、その目印まで待ってから操作を続けます。

```json
{
  "type":"block.input","block":"move","input":"STEPS","value":"4",
  "cues": {
    "target.visible":{"framing":{"kind":"input","block":"move","input":"STEPS","scale":1.2},"holdMs":350},
    "value.before":{"at":"four"},
    "value.entered":{"holdMs":600,"mode":"freeze"}
  }
}
```

この例は入力欄を先に映し、8秒の目印で入力を開始し、入力した4を600ms保持してから確定します。`atMs`を直接指定することもできます。入力前のHome・選択操作やブラウザーの反映時間があるため、音声・映像は厳密なサンプル単位の同期ではありません。実測時刻と30fpsの目安フレームを出力します。

「この定義」の言葉から構図の変更を開始する場合は、`view.focus`自体のbeforeへ目印を置きます。準備用のframingは先に適用されるため、見せ始める時刻の指定にはこちらを使います。

```json
{"type":"view.focus","subject":{"kind":"definition","block":"definition-id","scale":1,"move":"center"},"cues":{"before":{"at":"show-definition"}}}
```

目印に間に合わない場合、既定の`sync: {"late":"error","toleranceMs":120}`では失敗にします。前の操作や確認時間を短くする、録画外へ準備を移す、または音声の時刻を変更してください。`late:"warn"`なら続行し、遅れをtimelineとqualityへ記録します。動画全体を自動的に早送りして帳尻を合わせる処理ではありません。

目印を置ける節目は`before / name.before / scope.before / create.before / value.before / drop.before`です。操作が済んだ後に時刻だけを待っても先行を防げないため、完了後の節目にはatを指定できません。

## 変数作成の途中に確認時間を入れる

```json
{
  "type":"variable.create","name":"クローンID","scope":"local",
  "cues": {
    "dialog.opened":{"holdMs":300},
    "name.entered":{"framing":{"kind":"variableName"},"holdMs":500},
    "scope.selected":{"framing":{"kind":"variableScope","editorZoom":1.5},"holdMs":800},
    "created":{"holdMs":500}
  }
}
```

|操作|利用できる固有の節目|
|---|---|
|すべての操作|before / after|
|variable.create|dialog.opened / name.before / name.entered / scope.before / scope.selected / create.before / created|
|procedure.create|dialog.opened / definition.configured / created|
|block.input / block.field|target.visible / field.opened / value.before / value.entered（文字入力）/ value.committed / option.selected（選択メニュー）|
|block.add / block.move|drop.before / drop.completed|

type・入力形式・現在値によっては通らない節目があります。例えば元の値と同じため操作を省略した場合、入力の節目は発生しません。指定した節目を通らなかった場合は成功扱いにせず停止します。確認時間はそれぞれの節目に置きます。

## 文を見せ方の区切りに分ける

```json
{
  "start":"blank","setupSpeed":10,
  "setup":[{"type":"target.select","target":"Sprite1"}],
  "timing":{"move":250,"drag":600,"type":75,"pan":200,"pause":80},
  "beats":[
    {
      "id":"create-id","text":"クローンIDという変数を作ります",
      "before":[{"type":"variables","scope":"local","target":"Sprite1","names":[]}],
      "beforeMs":300,
      "actions":[{
        "type":"variable.create","name":"クローンID","scope":"local",
        "cues":{"scope.selected":{"framing":{"kind":"variableScope","editorZoom":1.5},"holdMs":800}}
      }],
      "after":[{"type":"variables","scope":"local","target":"Sprite1","names":["クローンID"]}],
      "afterMs":600
    }
  ]
}
```

対象名は元sb3から選びます。1つのbeatに複数の操作・節目を置けるため、一文を一律の構図で撮る必要はありません。後から説明する変数が先に存在したら、before / afterの検証で止められます。`names`は既定で完全一致、`exact:false`なら指定名が含まれることだけを確認します。

beatsと従来のactionsはどちらか一方を指定します。従来のactionsでもcuesは使えます。beatのbeforeMs / afterMsはその区切りの前後の確認時間です。beatのat / atMsはその区切りの操作を始める目印で、framingやcheck、holdMsの後に同期します。`narration.durationMs`を指定した場合、最後に余った時間だけを保持できますが、操作途中の確認時間の代わりにはなりません。

## 説明対象の構図

`framing`、`endFraming`、cues内のframing、または`view.focus.subject`で指定します。

|kind|対象|
|---|---|
|block|blockの全体|
|definition|定義ブロックの全体。blockを指定|
|input|block + input、必要ならfieldで指定した入力欄|
|variableName|開いている変数作成ダイアログの名前欄|
|variableScope|開いている変数作成ダイアログの適用範囲|
|dialog|現在開いている公式ダイアログ|
|costumeName|コスチュームタブの名前欄|
|monitor|scope・target・name/id・dataKind:variable/listで指定した表示中のモニター|
|stage|現在のステージ表示。全画面へ切り替える場合は先にstage.viewを実行|

コード対象にはscale:0.3〜1.5を指定できます。入力欄だけを対象にすれば、大きなブロック全体を入れるために文字を小さくする必要がありません。`editorZoom:1〜1.75`はダイアログ等も含むエディタ全体の拡大です。変更後の倍率は維持し、別の構図・view.configureで変更できます。

`move:"if-needed"`が既定です。対象が操作可能範囲に収まるなら画面を動かさず、外れている場合だけ移動します。`move:"center"`は中央へ移動します。操作に必要なスクロールを禁止する固定ロックではありません。durationは構図の移動時間（省略時はtiming.pan、未指定なら250ms）。`minTextPx`を指定すると、推定した出力上の文字サイズがその値未満なら停止します。文字を小さくして無理に収める処理はしません。

## 速度と状態検証

timingの単位はms。move（マウス移動）、drag（ブロックのドラッグ）、type（1文字）、pan（画面移動）、pause（通常の操作待ち）を個別指定できます。適用順はspeedの既定値 → カットのtiming → beatのtiming → 操作のtimingです。指定した操作・beatの終了時に元へ戻します。確認時間のholdMs / beforeMs / afterMsはspeedで短縮しません。durationを直接持つ実演操作はその指定を使います。

setupSpeedとsetupTimingは録画外の準備だけに適用します。省略時は従来と同じ速度です。音声同期のcuesはsetupには指定できません。

状態検証はbeat.before / after、cue.check、または`{"type":"state.assert","checks":[...]}`で行います。

- `variables / lists / costumes`: target、scope、names、exactで名前の一覧を検証。
- `variable / list`: target、scope、name/id、exists、任意のvalueで有無・値を検証。`exists:false`で「まだ作っていない」を確認。
- `block`: target、block、exists、任意のopcode。
- `tab / target / running`: valueで現在の状態を検証。
- `runtime`: conditionsに[条件待機](board.md)と同じ条件を指定して、その時点を確認。

検証失敗のカットは完成MP4を公開しません。乱数・実行中の作品は状態が変化するため、どの時点の状態を確認するか設定してください。

## 動作を観察する時間と、映像を止める時間

`holdMs`または`{"type":"presentation.hold","ms":800,"mode":"live"}`は現在の動きをそのまま収録します。mode:freezeは現在の映像を繰り返し、**収録するScratch音をその間だけ消音**します。

freeze中もScratch内部の変数・スクリプト・時間は進みます。解除後はその時点の画面へ戻ります。実行状態を完全に停止・保存・復元する機能ではありません。次の操作が特定の状態を必要とする場合は、state.assertやruntime.waitも指定します。freezeは録画中のカットまたは録画中のセッションで利用できます。

## 編集用の記録と簡易チェック

- `timeline.json`: beat・操作・節目・目印の予定/実測時刻・保持時間・説明対象の位置・推定文字サイズ。
- `timeline.csv`: 同じ記録の時刻・目安フレーム・台本文・対象位置を参照する表。UTF-8 BOM付き。
- `quality.json`: 見切れ、字幕領域との重なり、小さな文字、大きな画面移動、短い結果確認、ドラッグのポインターイベント間隔の候補。

位置は1920×1080の映像基準です。フレーム番号は時刻を30fpsに換算した目安で、録画画像を認識して操作の完了フレームを特定する機能ではありません。簡易チェックは指定された説明対象と操作ログを調べるもので、画面全体の文字やブロック、実際の全フレームの滑らかさを保証するものではありません。

YMM4ではこれらを参照し、停止・速度変更・下線や配置を編集します。CSVからYMM4プロジェクトへ自動インポートする機能は含みません。比較のひな形では同じ全体倍率でコスチューム名を順番に収録し、並べる編集はYMM4側で行います。

設定・目印・beatsはcut.jsonへ保存され、撮り直しでも引き継ぎます。失敗時もtimelineとqualityは診断用に残ります。既存のカットのactions形式も引き続き利用できます。

検証: `node --test tests/presentation.test.mjs`、`node tests/presentation.mjs`、`node tests/freeze-recording.mjs`。
