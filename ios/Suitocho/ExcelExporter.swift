import Foundation

/// 外部ライブラリなしで Excel（.xlsx / Office Open XML）を作る。
/// Excel 365（Windows・Mac・Web・iPhone）でそのまま開ける。
enum ExcelExporter {
    struct Row {
        var date: Date
        var kind: String
        var memo: String
        var amount: Int
        var isIncome: Bool
    }

    static let ledgerSheetName = "出納帳"
    static let summarySheetName = "月別集計"

    // スタイル番号（styles.xml の cellXfs の並び順）
    private enum Style: Int { case normal = 0, date = 1, number = 2, header = 3, month = 4 }

    static func workbook(rows: [Row], calendar: Calendar = .current) -> Data {
        let files: [(String, String)] = [
            ("[Content_Types].xml", contentTypes),
            ("_rels/.rels", rootRels),
            ("xl/workbook.xml", workbookXML(rowCount: rows.count)),
            ("xl/_rels/workbook.xml.rels", workbookRels),
            ("xl/styles.xml", styles),
            ("xl/worksheets/sheet1.xml", ledgerSheet(rows: rows, calendar: calendar)),
            ("xl/worksheets/sheet2.xml", summarySheet(rows: rows, calendar: calendar)),
        ]
        return ZipWriter.archive(files.map { (path: $0.0, data: Data($0.1.utf8)) })
    }

    // MARK: - シート

    private static func ledgerSheet(rows: [Row], calendar: Calendar) -> String {
        var xml = sheetHeader(cols: [12, 7, 30, 12, 12, 13])
        xml += "<row r=\"1\">"
            + ["日付", "区分", "内容", "収入", "支出", "残高"].enumerated()
                .map { stringCell(ref: "\(col($0.offset))1", $0.element, style: .header) }.joined()
            + "</row>"
        var balance = 0
        for (i, row) in rows.enumerated() {
            let r = i + 2
            balance += row.isIncome ? row.amount : -row.amount
            var cells = numberCell(ref: "A\(r)", serial(row.date, calendar: calendar), style: .date)
            cells += stringCell(ref: "B\(r)", row.kind)
            if !row.memo.isEmpty { cells += stringCell(ref: "C\(r)", row.memo) }
            cells += numberCell(ref: row.isIncome ? "D\(r)" : "E\(r)", row.amount, style: .number)
            let formula = r == 2 ? "D2-E2" : "F\(r - 1)+D\(r)-E\(r)"
            cells += formulaCell(ref: "F\(r)", formula, cached: balance, style: .number)
            xml += "<row r=\"\(r)\">\(cells)</row>"
        }
        xml += "</sheetData>"
        xml += "<autoFilter ref=\"A1:F\(rows.count + 1)\"/>"
        xml += "</worksheet>"
        return xml
    }

    /// 月ごとの収入・支出・差引。数式なので Excel 側で明細を直しても再計算される。
    private static func summarySheet(rows: [Row], calendar: Calendar) -> String {
        var months: [Int] = []           // 各月1日のシリアル値
        var totals: [Int: (Int, Int)] = [:]
        for row in rows {
            let c = calendar.dateComponents([.year, .month], from: row.date)
            let key = serial(year: c.year ?? 1900, month: c.month ?? 1, day: 1)
            if totals[key] == nil { months.append(key); totals[key] = (0, 0) }
            if row.isIncome { totals[key]!.0 += row.amount } else { totals[key]!.1 += row.amount }
        }
        months.sort()

        let s = "'\(ledgerSheetName)'"
        var xml = sheetHeader(cols: [12, 13, 13, 13])
        xml += "<row r=\"1\">"
            + ["月", "収入", "支出", "差引"].enumerated()
                .map { stringCell(ref: "\(col($0.offset))1", $0.element, style: .header) }.joined()
            + "</row>"
        for (i, m) in months.enumerated() {
            let r = i + 2
            let (inc, exp) = totals[m]!
            let range = "\(s)!$A:$A,\">=\"&A\(r),\(s)!$A:$A,\"<\"&EDATE(A\(r),1)"
            var cells = numberCell(ref: "A\(r)", m, style: .month)
            cells += formulaCell(ref: "B\(r)", "SUMIFS(\(s)!$D:$D,\(range))", cached: inc, style: .number)
            cells += formulaCell(ref: "C\(r)", "SUMIFS(\(s)!$E:$E,\(range))", cached: exp, style: .number)
            cells += formulaCell(ref: "D\(r)", "B\(r)-C\(r)", cached: inc - exp, style: .number)
            xml += "<row r=\"\(r)\">\(cells)</row>"
        }
        xml += "</sheetData></worksheet>"
        return xml
    }

    private static func sheetHeader(cols widths: [Int]) -> String {
        var xml = #"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#
        xml += #"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">"#
        xml += #"<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>"#
        xml += "<cols>"
        for (i, w) in widths.enumerated() {
            xml += "<col min=\"\(i + 1)\" max=\"\(i + 1)\" width=\"\(w)\" customWidth=\"1\"/>"
        }
        xml += "</cols><sheetData>"
        return xml
    }

    // MARK: - セル

    private static func stringCell(ref: String, _ text: String, style: Style = .normal) -> String {
        "<c r=\"\(ref)\" s=\"\(style.rawValue)\" t=\"inlineStr\"><is><t xml:space=\"preserve\">\(escape(text))</t></is></c>"
    }

    private static func numberCell(ref: String, _ value: Int, style: Style) -> String {
        "<c r=\"\(ref)\" s=\"\(style.rawValue)\"><v>\(value)</v></c>"
    }

    private static func formulaCell(ref: String, _ formula: String, cached: Int, style: Style) -> String {
        "<c r=\"\(ref)\" s=\"\(style.rawValue)\"><f>\(escape(formula))</f><v>\(cached)</v></c>"
    }

    private static func col(_ index: Int) -> String {
        String(Character(UnicodeScalar(UInt8(65 + index))))
    }

    static func escape(_ s: String) -> String {
        var out = ""
        for ch in s.unicodeScalars {
            switch ch {
            case "&": out += "&amp;"
            case "<": out += "&lt;"
            case ">": out += "&gt;"
            case "\"": out += "&quot;"
            case "\t", "\n", "\r": out.unicodeScalars.append(ch)
            default:
                // XML で使えない制御文字は捨てる
                if ch.value >= 0x20 { out.unicodeScalars.append(ch) }
            }
        }
        return out
    }

    // MARK: - 日付（Excel のシリアル値：1899/12/30 を 0 とする日数）

    private static func serial(_ date: Date, calendar: Calendar) -> Int {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return serial(year: c.year ?? 1900, month: c.month ?? 1, day: c.day ?? 1)
    }

    static func serial(year: Int, month: Int, day: Int) -> Int {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let base = utc.date(from: DateComponents(year: 1899, month: 12, day: 30))!
        let d = utc.date(from: DateComponents(year: year, month: month, day: day))!
        return Int((d.timeIntervalSince(base) / 86_400).rounded())
    }

    // MARK: - 固定の XML

    private static func workbookXML(rowCount: Int) -> String {
        """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" \
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\
        <bookViews><workbookView/></bookViews>\
        <sheets><sheet name="\(ledgerSheetName)" sheetId="1" r:id="rId1"/>\
        <sheet name="\(summarySheetName)" sheetId="2" r:id="rId2"/></sheets>\
        <definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\
        '\(ledgerSheetName)'!$A$1:$F$\(rowCount + 1)</definedName></definedNames>\
        <calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>
        """
    }

    private static let contentTypes = """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\
        <Default Extension="xml" ContentType="application/xml"/>\
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\
        <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\
        <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\
        </Types>
        """

    private static let rootRels = """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\
        </Relationships>
        """

    private static let workbookRels = """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>\
        <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\
        </Relationships>
        """

    private static let styles = """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\
        <numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy/mm/dd"/>\
        <numFmt numFmtId="165" formatCode="yyyy&quot;年&quot;m&quot;月&quot;"/></numFmts>\
        <fonts count="2"><font><sz val="11"/><name val="Yu Gothic"/><family val="2"/></font>\
        <font><b/><sz val="11"/><name val="Yu Gothic"/><family val="2"/></font></fonts>\
        <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>\
        <fill><patternFill patternType="solid"><fgColor rgb="FFDDEBE6"/><bgColor indexed="64"/></patternFill></fill></fills>\
        <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>\
        <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\
        <cellXfs count="5">\
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>\
        <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>\
        <xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>\
        <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>\
        <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>\
        </cellXfs>\
        <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>\
        </styleSheet>
        """
}
