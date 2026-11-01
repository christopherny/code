import Foundation

/// .xlsx の入れ物になる ZIP を作る最小実装（無圧縮 / stored）。
enum ZipWriter {
    static func archive(_ files: [(path: String, data: Data)]) -> Data {
        var out = Data()
        var central = Data()
        let dosTime: UInt16 = 0
        let dosDate: UInt16 = (0 << 9) | (1 << 5) | 1   // 1980-01-01

        for file in files {
            let name = Data(file.path.utf8)
            let crc = crc32(file.data)
            let size = UInt32(file.data.count)
            let offset = UInt32(out.count)

            // ローカルファイルヘッダ
            out.le32(0x0403_4b50)
            out.le16(20)            // 展開に必要なバージョン
            out.le16(0)             // フラグ
            out.le16(0)             // 圧縮方式: stored
            out.le16(dosTime)
            out.le16(dosDate)
            out.le32(crc)
            out.le32(size)
            out.le32(size)
            out.le16(UInt16(name.count))
            out.le16(0)             // extra 長
            out.append(name)
            out.append(file.data)

            // セントラルディレクトリ
            central.le32(0x0201_4b50)
            central.le16(20)        // 作成バージョン
            central.le16(20)
            central.le16(0)
            central.le16(0)
            central.le16(dosTime)
            central.le16(dosDate)
            central.le32(crc)
            central.le32(size)
            central.le32(size)
            central.le16(UInt16(name.count))
            central.le16(0)         // extra 長
            central.le16(0)         // コメント長
            central.le16(0)         // ディスク番号
            central.le16(0)         // 内部属性
            central.le32(0)         // 外部属性
            central.le32(offset)
            central.append(name)
        }

        let centralOffset = UInt32(out.count)
        out.append(central)

        // 終端レコード
        out.le32(0x0605_4b50)
        out.le16(0)
        out.le16(0)
        out.le16(UInt16(files.count))
        out.le16(UInt16(files.count))
        out.le32(UInt32(central.count))
        out.le32(centralOffset)
        out.le16(0)
        return out
    }

    private static let crcTable: [UInt32] = (0..<256).map { i -> UInt32 in
        var c = UInt32(i)
        for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func crc32(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        for byte in data { c = crcTable[Int((c ^ UInt32(byte)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFF_FFFF
    }
}

private extension Data {
    mutating func le16(_ v: UInt16) {
        append(contentsOf: [UInt8(v & 0xFF), UInt8(v >> 8)])
    }
    mutating func le32(_ v: UInt32) {
        append(contentsOf: [UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF), UInt8((v >> 16) & 0xFF), UInt8(v >> 24)])
    }
}
