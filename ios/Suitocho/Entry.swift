import Foundation
import SwiftData

enum Kind: String, CaseIterable, Identifiable {
    case expense = "支出"
    case income = "収入"

    var id: String { rawValue }
}

/// 出納帳の1件分の記録。端末内（SwiftData）に保存される。
@Model
final class Entry {
    var date: Date
    var kindRaw: String
    var amount: Int
    var memo: String
    var createdAt: Date

    init(date: Date, kind: Kind, amount: Int, memo: String) {
        self.date = date
        self.kindRaw = kind.rawValue
        self.amount = amount
        self.memo = memo
        self.createdAt = Date()
    }

    var kind: Kind { Kind(rawValue: kindRaw) ?? .expense }
    var signedAmount: Int { kind == .income ? amount : -amount }
}
