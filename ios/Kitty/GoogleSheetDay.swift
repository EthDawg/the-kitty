import Foundation

/// A decision records the day the user actually acted, in the spreadsheet's time zone.
/// A Sheets date is a numeric day since 1899-12-30; an ISO-looking string breaks MAXIFS.
enum GoogleSheetDay {
    static func name(at date: Date = Date(), zone: TimeZone) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier:"en_US_POSIX"); f.calendar = Calendar(identifier:.gregorian)
        f.timeZone = zone; f.dateFormat = "yyyy-MM-dd"; return f.string(from:date)
    }
    static func serial(_ iso: String) -> Int? {
        guard iso.utf8.count == 10 else { return nil }
        let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]; f.timeZone = TimeZone(secondsFromGMT:0)
        guard let d = f.date(from:iso), f.string(from:d) == iso else { return nil }
        return Int((d.timeIntervalSince1970 / 86400).rounded()) + 25569
    }
    static let numberFormat = ["type":"DATE","pattern":"dd/mm/yyyy"]
    static func cell(_ iso: String) -> [String:Any]? {
        guard let value = serial(iso) else { return nil }
        return ["userEnteredValue":["numberValue":value], "userEnteredFormat":["numberFormat":numberFormat]]
    }
}
