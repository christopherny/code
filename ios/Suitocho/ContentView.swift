import SwiftUI
import SwiftData
import UIKit

struct ContentView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: [SortDescriptor(\Entry.date, order: .reverse),
                  SortDescriptor(\Entry.createdAt, order: .reverse)])
    private var entries: [Entry]

    @State private var kind: Kind = .expense
    @State private var amountText = ""
    @State private var memo = ""
    @State private var date = Date()
    @State private var month = Date().startOfMonth
    @State private var exportFile: ExportFile?
    @State private var errorMessage: String?
    @State private var savedCount = 0
    @FocusState private var focus: Field?

    private enum Field { case amount, memo }

    private var amount: Int { Int(amountText.filter { $0.isASCII && $0.isNumber }) ?? 0 }

    private var monthEntries: [Entry] {
        entries.filter { Calendar.current.isDate($0.date, equalTo: month, toGranularity: .month) }
    }

    private var balance: Int { entries.reduce(0) { $0 + $1.signedAmount } }

    /// よく使う「内容」の候補（使用回数の多い順）
    private var suggestions: [String] {
        var freq: [String: Int] = [:]
        for e in entries where !e.memo.isEmpty { freq[e.memo, default: 0] += 1 }
        return freq.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .prefix(12).map(\.key)
    }

    var body: some View {
        NavigationStack {
            List {
                inputSection
                summarySection
                listSection
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("出納帳")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Text("残高 \(yen(balance))")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: export) {
                        Label("Excelを送る", systemImage: "square.and.arrow.up")
                    }
                    .disabled(entries.isEmpty)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完了") { focus = nil }
                }
            }
            .sheet(item: $exportFile) { file in
                ShareSheet(items: [file.url])
                    .presentationDetents([.medium, .large])
            }
            .alert("エラー", isPresented: Binding(get: { errorMessage != nil },
                                                set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .sensoryFeedback(.success, trigger: savedCount)
        }
    }

    // MARK: - 入力

    private var inputSection: some View {
        Section {
            Picker("区分", selection: $kind) {
                ForEach(Kind.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)

            HStack {
                Text("¥").font(.title2).foregroundStyle(.secondary)
                TextField("金額", text: $amountText)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .font(.title.bold().monospacedDigit())
                    .focused($focus, equals: .amount)
                    .onChange(of: amountText) { _, newValue in
                        let digits = String(newValue.filter { $0.isASCII && $0.isNumber }.prefix(12))
                        let formatted = Int(digits).map { $0.formatted(.number) } ?? ""
                        if formatted != newValue { amountText = formatted }
                    }
            }

            TextField("内容（例：昼食、交通費、給与）", text: $memo)
                .focused($focus, equals: .memo)
                .submitLabel(.done)

            if !suggestions.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(suggestions, id: \.self) { s in
                            Button(s) { memo = s }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                        }
                    }
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }

            DatePicker("日付", selection: $date, displayedComponents: .date)

            Button(action: add) {
                Text("登録")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(kind == .income ? .blue : .red)
            .disabled(amount == 0)
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
        }
    }

    // MARK: - 月の集計

    private var summarySection: some View {
        let income = monthEntries.filter { $0.kind == .income }.reduce(0) { $0 + $1.amount }
        let expense = monthEntries.filter { $0.kind == .expense }.reduce(0) { $0 + $1.amount }
        return Section {
            HStack {
                Button { shiftMonth(-1) } label: { Image(systemName: "chevron.left") }
                Spacer()
                Text(monthLabel(month)).font(.headline)
                Spacer()
                Button { shiftMonth(1) } label: { Image(systemName: "chevron.right") }
            }
            .buttonStyle(.borderless)

            HStack {
                summaryItem("収入", income, .blue)
                summaryItem("支出", expense, .red)
                summaryItem("差引", income - expense, .primary)
            }
        }
    }

    private func summaryItem(_ title: String, _ value: Int, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(yen(value)).font(.subheadline.bold().monospacedDigit()).foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - 明細

    private var listSection: some View {
        Section {
            if monthEntries.isEmpty {
                Text("この月の記録はありません").foregroundStyle(.secondary)
            }
            ForEach(monthEntries) { e in
                HStack(spacing: 12) {
                    Text(dayLabel(e.date))
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 40, alignment: .leading)
                    Text(e.memo.isEmpty ? "（内容なし）" : e.memo).lineLimit(1)
                    Spacer()
                    Text((e.kind == .income ? "+" : "−") + yen(e.amount))
                        .font(.body.bold().monospacedDigit())
                        .foregroundStyle(e.kind == .income ? .blue : .red)
                }
            }
            .onDelete { offsets in
                let targets = offsets.map { monthEntries[$0] }
                for t in targets { context.delete(t) }
            }
        } header: {
            Text("明細（左にスワイプで削除）")
        }
    }

    // MARK: - 操作

    private func add() {
        guard amount > 0 else { return }
        context.insert(Entry(date: date, kind: kind, amount: amount,
                             memo: memo.trimmingCharacters(in: .whitespacesAndNewlines)))
        amountText = ""
        memo = ""
        focus = nil
        month = date.startOfMonth
        savedCount += 1
    }

    private func shiftMonth(_ delta: Int) {
        month = Calendar.current.date(byAdding: .month, value: delta, to: month) ?? month
    }

    private func export() {
        let rows = entries
            .sorted { ($0.date, $0.createdAt) < ($1.date, $1.createdAt) }
            .map { ExcelExporter.Row(date: $0.date, kind: $0.kind.rawValue, memo: $0.memo,
                                     amount: $0.amount, isIncome: $0.kind == .income) }
        do {
            let data = ExcelExporter.workbook(rows: rows)
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyyMMdd"
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("出納帳_\(f.string(from: Date())).xlsx")
            try data.write(to: url, options: .atomic)
            exportFile = ExportFile(url: url)
        } catch {
            errorMessage = "Excelファイルを作れませんでした：\(error.localizedDescription)"
        }
    }

    // MARK: - 表示用

    private func yen(_ n: Int) -> String { "¥" + n.formatted(.number) }

    private func monthLabel(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month], from: d)
        return "\(c.year ?? 0)年\(c.month ?? 0)月"
    }

    private func dayLabel(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.month, .day], from: d)
        return "\(c.month ?? 0)/\(c.day ?? 0)"
    }
}

private struct ExportFile: Identifiable {
    let id = UUID()
    let url: URL
}

/// iOS 標準の共有シート（メール・LINE・Excel・OneDrive・ファイル など）
private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

extension Date {
    var startOfMonth: Date {
        Calendar.current.date(from: Calendar.current.dateComponents([.year, .month], from: self)) ?? self
    }
}

#Preview {
    ContentView().modelContainer(for: Entry.self, inMemory: true)
}
