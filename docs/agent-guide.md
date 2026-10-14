# 外部エージェントから利用する

このツールはローカルHTTP APIで公式Scratchエディタを操作し、映像素材とsb3を生成します。AIエージェント、台本・字幕・ナレーション生成、動画の編集・公開は含みません。

## 起動と接続

Node.js 18以上、Google Chrome、FFmpeg（libx264）を用意し、リポジトリのルートで実行します。

```powershell
npm ci
npm run setup
npm start
```

既定のURLは`http://127.0.0.1:8601`。`GET /health`で起動を確認し、`GET /api/capabilities`で対応操作・版・動画設定を取得します。サーバーは起動したままにします。ポート変更は`PORT`、FFmpeg指定は`FFMPEG_PATH`、Edge利用は`BROWSER_CHANNEL=msedge`です。

管理画面は`/`、独立カットは`/cuts.html`、操作一覧とパラメーターは`/api.html`。ブラウザーを自動操作しなくても、以下のHTTP APIで利用できます。専用のブラウザーはツールが起動します。

## 目的に応じた方式

|目的|使うAPI|特徴|
|---|---|---|
|sb3を最初から組み立てる制作映像|`POST /api/jobs`|自動手順、完成比較、途中保存・再開、全体／場面別出力|
|台本に必要な操作・実演のカット|`POST /api/cuts`|録画外の準備と録画する操作を分け、保存設定から撮り直せる|
|画面を確認しながら1操作ずつ試す|`POST /api/sessions`|状態・スクリーンショットを取得し、必要な範囲だけ録画できる|

作画、盤面クリック、リスト設定・読み取り、条件待機、モニター制御、`variable.set / script.run / sprite.drag / stage.view`は**独立カットまたは個別セッション**で使います。通常の再構築ジョブには指定できません。

## sb3の読み込みと構造確認

`POST /api/projects`へ**sb3のバイト列**を`Content-Type: application/octet-stream`で送ります。JSONやmultipartではありません。任意の`X-File-Name`には`encodeURIComponent`でエンコードした名前を指定できます。

返る`id`がprojectIdです。続いて`GET /api/projects/{id}/structure`を読み、対象名・isStage・scripts・blocks・variables・lists・costumes・soundsを確認します。対象名やブロックID、入力名、素材名を推測しないでください。

- 全体再構築用の手順は`GET /api/projects/{id}/plan`。素材追加の操作を含みます。
- 素材を最初から読み込むカットの手順は`GET /api/projects/{id}/cut-plan`。
- コードを途中から作るカットでは、cut-planの前半をsetup、必要な範囲をactionsに分けます。
- ブロックIDは対象ごとの範囲です。先に`target.select`を実行します。ステージには`isStage:true`も指定します。
- 読み込んだ元ID、または`block.add`のsourceIdでブロックを指定できます。構造APIは元sb3、状態APIは現在の編集中のデータです。

## 最小のカット生成例

以下を`make-cut.mjs`として保存し、`node make-cut.mjs "PEN動作確認.sb3"`で実行できます。Node.js標準機能だけを使います。サーバーが必要です。この例は完成済みの作品を緑の旗で実行し、1秒収録して停止します。作品の動作に合わせてactionsを変更してください。

```js
import fs from 'node:fs/promises';
import path from 'node:path';

const base=(process.env.STUDIO_URL || 'http://127.0.0.1:8601').replace(/\/$/, '');
const file=process.argv[2];
if(!file)throw new Error('sb3のパスを指定してください。');
async function request(route, options={}) {
  const response=await fetch(base+route, {...options, signal:AbortSignal.timeout(60000)});
  const body=await response.json();
  if(!response.ok)throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}
const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
await request('/health');
const capabilities=await request('/api/capabilities');
const project=await request('/api/projects', {
  method:'POST',
  headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(path.basename(file))},
  body:await fs.readFile(file)
});
const structure=await request(`/api/projects/${project.id}/structure`);
const target=structure.targets.find(t=>!t.isStage) || structure.targets.find(t=>t.isStage);
const actions=[{type:'project.start'},{type:'wait',ms:1000},{type:'project.stop'}];
for(const action of actions)if(!capabilities.operations.includes(action.type))throw new Error(`未対応: ${action.type}`);
const cut=await request('/api/cuts', post({
  projectId:project.id,title:'完成作品の実演',start:'project',speed:1,subtitleMargin:220,
  setup:[target.selectAction],actions,beforeMs:500,afterMs:1000
}));
const deadline=Date.now()+15*60*1000;
let job;
while(true) {
  job=await request(`/api/jobs/${cut.id}`);
  if(!['running','encoding'].includes(job.status))break;
  if(Date.now()>deadline) {
    await request(`/api/jobs/${cut.id}/cancel`,post({}));
    throw new Error(`待機上限を超えました。中止要求を送信しました: ${cut.id}`);
  }
  await new Promise(resolve=>setTimeout(resolve,500));
}
if(job.status!=='completed')throw new Error(job.error || `制作終了: ${job.status}`);
const movie=job.artifacts.find(a=>a.name==='movie.mp4');
if(!movie)throw new Error('完成動画がありません。');
const response=await fetch(new URL(movie.url,base),{signal:AbortSignal.timeout(60000)});
if(!response.ok)throw new Error(`動画取得失敗: HTTP ${response.status}`);
const output=path.resolve(`cut-${cut.id}.mp4`);
await fs.writeFile(output,Buffer.from(await response.arrayBuffer()));
console.log(output);
```

`POST /api/cuts`の成功は受付であり、動画完成ではありません。必ずジョブの`status: completed`を待ち、`artifacts`の実際のURLから取得します。`failed / cancelled`は成功として扱いません。カットの`step / total`は準備／撮影の各段階で切り替わるため、全体の百分率ではありません。

## カット設定

`start: "project"`は元の状態、`start: "blank"`はコード・変数・リスト・メッセージを空にした状態です。スプライト本体は元sb3から準備します。画像・音を空にして作画する場合は`start:"blank", clearAssets:true`を指定します。

setupは録画外、actionsは録画する操作です。framing / endFramingは前後のコード領域の構図。`beforeMs / afterMs`は0〜30000ms、既定500 / 1000msです。実行中のScratchは余白の間も動きます。speedは0.25〜10でマウスや入力の速度を変えますが、`wait.ms`やScratchプログラムの実行速度を変更する設定ではありません。

標準出力は日本語・1920×1080・30fps・H.264/AAC MP4。Scratchの実行音を録音します。字幕用の余白は下220pxが既定で、コードの操作対象が近づくと中央へスクロールします。操作中はカーソルを表示し、編集後と収録開始前は隠します。ゲームのステージ上のクリック・ドラッグ後は、待機・条件待機・キー入力と撮影後の余白でも表示を維持します。ステージ外への移動、編集操作、失敗時には隠します。

`editorZoom:1.5`でメニュー・タブ・ブロック・ステージ全体を150%にできます。範囲1〜1.75、既定1。ジョブ・カット・セッションの作成時、または`view.configure`で指定します。映像は1920×1080のままで、画面に入る範囲は狭くなります。コード領域のminScaleやframing.scaleとは別の倍率です。保存地点とカット設定にも保持します。字幕余白のpxは出力映像基準のままです。

詳しい操作例:

- [独立カット・撮り直し・実演](cuts.md)
- [コスチューム作画](paint.md)
- [盤面クリック・リスト・条件待機](board.md)
- [変数・リストのモニター](monitors.md)

## 個別セッション

1. `POST /api/sessions`へ`{"projectId":"…","blank":false}`を送る。返るidがsessionIdです。コードを空にするならblank:true、素材追加も収録するならanimateAssets:trueを併用します。
2. `POST /api/sessions/{id}/actions`へ操作オブジェクトまたはその配列を送る。応答のresultsは順番に対応します。
3. `GET /api/sessions/{id}/state`と`GET /api/sessions/{id}/screenshot`で結果を確認する。状態取得自体はカーソル・画面を動かしません。
4. 録画は`POST /api/sessions/{id}/recording/start`→操作→`POST /api/sessions/{id}/recording/stop`。停止応答のurlがMP4です。
5. `GET /api/sessions/{id}/project.sb3`で保存し、終了時は`DELETE /api/sessions/{id}`で専用ブラウザーを閉じる。

同じセッションの変更操作は完了を待って順番に呼びます。busy中の並行actionsはエラーになります。動画制作中に新しいセッションは作れません。セッション作成後も録画開始・停止・削除とactionsを並行させないでください。

## 座標と番号

|対象|座標・番号|
|---|---|
|block.add / block.moveのplace.x,y|コードのワークスペース座標。右・下が正方向。画面上のピクセル座標とは異なる|
|sprite.dragのx,y|ステージ中心(0,0)、右が+x、上が+y|
|paint.shapeのx,y|コスチューム中心基準の図形の左上。右が+x、上が+y。幅・高さに枠線を含めない|
|monitor.layoutのx,y|480×360のステージ左上(0,0)、右・下が正方向|
|mouse.*のx,y|1920×1080の画面座標|
|board.clickのrow,column|1始まり。左下が(1,1)、行は下から上、列は左から右|
|list.*とmonitor.scrollのindex|1始まり|
|costume.select / 素材のassetIndex / paint.select|0始まり|

接続は`place.after`、または`place.parent`と`place.input`で指定します。x,yで置くと周りに自動接続しません。変数・リストはscope:global / localとnameまたはidで識別します。localならtargetも指定できます。数値の1と文字列"1"は条件待機の等価比較では同じ扱いです。

状態APIのboxと、エディタ内部のDOM座標はCSSピクセルです。全体拡大時にboxを`mouse.*`の出力映像座標へ使う場合は、x・y・幅・高さへ状態のeditorZoomを掛けます。高水準のブロック・盤面・作画・モニターAPIでは自動変換するため、この計算は不要です。

## 保存・失敗時の扱い

- アップロードのprojectIdと個別sessionIdはサーバー再起動で失われます。必要なら再アップロードします。
- ジョブとカットの履歴・素材・設定は`outputs/<id>/`に残ります。`GET /api/jobs`で取得できます。
- 通常ジョブの再開は`resumable:true`を確認して`POST /api/jobs/{id}/resume`。出力フォルダー全体を保持してください。
- カットの撮り直しは`POST /api/cuts/{id}/retake`へ`{}`、変更時はactions等を送ります。元sb3とsetupから再実行し、新しい動画を保存します。途中再開ではありません。
- 個別操作が失敗すると配列の後続は実行しません。それ以前の変更は残る場合があります。stateのlastActionと画面を確認し、同じ追加命令を無条件に再送しないでください。
- タイムアウトや応答途切れでも、操作・ジョブが受け付けられている場合があります。既知のsessionId/jobIdの状態を確認します。受付結果を失ったジョブは履歴の名前・startedAt等で確認します。
- `runtime.wait`で作品の値・リスト長・クローン数の条件を待ち、timeoutMsを指定します。無限ループの作品でrunning:falseを待つには停止操作が必要です。
- sb3は実行中のスレッド、ペン描画、乱数状態、リストのスクロール位置を保存しません。実演の準備とmonitor.scrollを設定に含めます。入力や乱数を含む作品は撮り直し結果が変わる場合があります。

## 対応範囲

PENに対応しています。作画はベクターの四角形・楕円と単色・枠線・選択・複製・名前変更。ビットマップ／自由描画の自動編集、音声波形の編集、クラウド同期、ハードウェア拡張、クローン固有のモニター操作は未対応です。未知のブロック・入力の扱いはcapabilitiesと実際の操作結果で確認してください。

新規スプライトの追加APIはありません。必要なスプライトを含むsb3を先に用意します。OSの素材ファイル選択ダイアログは収録せず、公式アップロードメニューを開いた後に元sb3の素材を自動選択します。

APIのブロック接続・ペイント・ドラッグ用アダプターは公式エディタ15.1.1に依存します。vendorの版を変更する場合は関連テストが必要です。生成動画・利用者の作品・vendor・node_modules・検証用出力はGitには含めません。
