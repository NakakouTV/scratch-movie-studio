# コスチュームの作画

独立カット画面でsb3を読み込み、「コスチューム作画のサンプル」を開いて対象を選び、「作画サンプルを設定」→「このカットを撮影」で、空マス・白マス・黒マスを描く動画を作れます。コードと素材を撮影前に空にします。元sb3と既存の動画は変更しません。

公式のベクターペイントを使います。図形は実際のドラッグで描き、色は公式カラーピッカーのスライダー、枠線の幅・名前は文字入力、複製は右クリックメニューを収録します。操作終了時にはカーソルを隠します。

## 操作API

独立カットのsetup/actions、個別セッションのactionsで使用します。通常の自動再構築は従来の素材アップロードを使い、作画操作は受け付けません。

| 操作 | 指定 |
| --- | --- |
| `costume.create` | 空のベクターコスチュームを「描く」から追加。任意の`name` |
| `costume.duplicate` | 選択中のコスチュームを複製。任意の`index`（0始まり）・`name` |
| `costume.rename` | `name`、任意の`index`（省略時は選択中） |
| `paint.view` | `scale`: 1〜8の整数。1が100%、4が400%。公式の倍率ボタンを使用 |
| `paint.shape` | `shape`: `rectangle` / `ellipse`、`x,y,width,height`、任意の`fill,stroke,strokeWidth` |
| `paint.select` | `index`: 図形番号（0始まり）。実際に図形をクリックして選択 |
| `paint.style` | 選択中の図形の`fill,stroke,strokeWidth`を変更。未選択なら次に描く図形の設定 |

図形の`x,y`は左上位置です。コスチュームの中心が(0,0)、右が+x、上が+y。`width,height`はScratchでの大きさで、枠線を含まない正の値（最大720×540）です。例: `x:-12,y:12,width:24,height:24`は中心に24×24の四角形を描きます。倍率・スクロールから画面座標へ変換し、ドラッグ座標の丸めによる小さな差だけを描画後に補正します。

色は`#rrggbb`、透明は`null`。単色のみです。枠線の幅は画面の入力値0〜100で、0は枠線なし。公式ペイントでは幅4の枠線を付けた24×24の四角形は、保存SVGで26×26になります。名前は1〜100文字。同名コスチュームがある場合はエラーにします。

`paint.shape`は新しい図形を描きます。既存の図形を変更する場合は`paint.select`→`paint.style`を使います。図形番号はコスチューム内で描画順に付け、複製・保存して再読み込みした場合はそのコスチュームの状態から取得します。内部のPaper.js IDを再読み込み後まで保持するものではありません。

操作結果と`GET /api/sessions/{id}/state`の`paint`に、図形番号・選択状態・`bounds`（枠線なし）・`strokeBounds`（枠線を含む寸法）、倍率・スタイルが返ります。コードタブやビットマップでは`paint: null`です。`costume.duplicate`と`costume.rename`はビットマップでも使えます。

## 独立カット例

```json
{
  "projectId": "アップロードしたID",
  "title": "空マスを描く",
  "start": "blank",
  "clearAssets": true,
  "setup": [{"type":"target.select","target":"Sprite1"}],
  "actions": [
    {"type":"costume.create","name":"空マス"},
    {"type":"paint.view","scale":4},
    {"type":"paint.shape","shape":"rectangle","x":-12,"y":12,"width":24,"height":24,"fill":"#008000","stroke":"#000000","strokeWidth":0},
    {"type":"paint.style","strokeWidth":4}
  ]
}
```

対象名は実際のsb3に合わせます。`clearAssets:true`は`start:blank`の場合だけ指定でき、全対象の画像・音を録画外で空にします。各対象には一時的な透明画像を1枚用意し、最初の`costume.create`でその画像を公式UIから削除します。作画した画像とコードは`result.sb3`にも保存します。

画面外・他の図形に完全に隠れた図形はクリックできず、エラーになります。描画範囲が画面下の字幕余白に入る場合も停止します。倍率を下げるか位置を変更してください。自由描画・ビットマップ編集・グラデーション指定・テキスト作画は今回の対象外です。

検証: `node tests/paint-actions.mjs`。台本の3コスチューム、24×24/26×26、色変更、保存SVGと再読み込み、MP4、入力エラーを確認します。
