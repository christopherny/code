# 出納帳（iPhone アプリ）

金額・区分（支出／収入）・内容を入力して、出納帳を Excel（.xlsx）で送れる iPhone アプリです。
Excel 365（Windows / Mac / Web / iPhone）でそのまま開けます。外部ライブラリは使っていません。

## できること
- 支出／収入の切り替え、金額（3桁区切り）、内容、日付（初期値は今日）を入力して登録
- 内容は過去によく使ったものがボタンで出る
- 月ごとの収入・支出・差引、全体の残高を表示
- 明細は左スワイプで削除
- 右上の共有ボタンから Excel を送る（メール・LINE・Excel アプリ・OneDrive・ファイル など）

### Excel の中身
| シート | 内容 |
|---|---|
| 出納帳 | 日付／区分／内容／収入／支出／残高（残高は数式、見出し固定・フィルター付き） |
| 月別集計 | 月／収入／支出／差引（SUMIFS の数式なので、明細を直すと再計算） |

## TestFlight で配布する手順
必要なもの：Mac（Xcode 16 以降）、Apple Developer Program（有料）

1. Mac で `ios/Suitocho.xcodeproj` を開く
2. 左のプロジェクト → ターゲット「Suitocho」→ **Signing & Capabilities**
   - **Team** に自分の開発者アカウントを選ぶ
   - **Bundle Identifier** を自分用に変える（例：`com.自分の名前.suitocho`）
3. [App Store Connect](https://appstoreconnect.apple.com) →「マイ App」→「＋」→ 新規 App
   - 名前：出納帳（他と重複する場合は「出納帳 by ○○」など）
   - バンドル ID：手順 2 で決めたもの
4. Xcode で、上部の実行先を **Any iOS Device (arm64)** にして **Product → Archive**
5. 出てきたウィンドウで **Distribute App → TestFlight & App Store** → アップロード
6. 10〜30分ほどで App Store Connect の **TestFlight** タブにビルドが出るので、
   「内部テスト」グループに自分を追加 → iPhone の **TestFlight アプリ**からインストール

※ 暗号化の申告（輸出コンプライアンス）は設定済みなので聞かれません。
※ TestFlight のビルドは 90 日で期限切れになります。期限前に「ビルド番号（CURRENT_PROJECT_VERSION）を上げて再アップロード」すれば、データはそのまま続けて使えます。

## データについて
データは iPhone 内（SwiftData）に保存されます。アプリを削除すると消えるので、ときどき Excel を送ってバックアップしてください。
