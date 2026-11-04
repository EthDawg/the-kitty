import SwiftUI

enum KittyTheme {
  static func color(_ light: UInt32, _ dark: UInt32) -> Color {
    Color(
      uiColor: UIColor { traits in
        let hex = traits.userInterfaceStyle == .dark ? dark : light
        return UIColor(
          red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
          blue: CGFloat(hex & 255) / 255, alpha: 1)
      })
  }
  static let background = color(0xF7F5EF, 0x101F1D)
  static let surface = color(0xFFFFFF, 0x192C29)
  static let ink = color(0x182D2B, 0xF7F5EF)
  static let secondary = color(0x5E706A, 0xAABEB3)
  static let accent = color(0x174E4A, 0xB8DCCB)
  static let soft = color(0xDCE9DF, 0x284B40)
  static let line = color(0xD9DFD7, 0x3C564B)
  static let positive = color(0x246348, 0xA7D9B6)
  static let warning = color(0x825414, 0xF5CD8F)
  static let peach = Color(red: 0.95, green: 0.71, blue: 0.55)
  static let hero = Color(red: 0.09, green: 0.306, blue: 0.29)
}
struct KittyCard<Content: View>: View {
  @ViewBuilder let content: Content
  var body: some View {
    VStack(alignment: .leading, spacing: 16) { content }.padding(20).frame(
      maxWidth: .infinity, alignment: .leading
    ).background(KittyTheme.surface, in: RoundedRectangle(cornerRadius: 24)).overlay(
      RoundedRectangle(cornerRadius: 24).stroke(KittyTheme.line.opacity(0.6), lineWidth: 0.5))
  }
}
struct SectionTitle: View {
  let title: String
  var body: some View {
    Text(title).font(.title3.weight(.semibold)).foregroundStyle(KittyTheme.ink)
      .accessibilityAddTraits(.isHeader)
  }
}
struct Pill: View {
  let title: String
  var symbol: String = "checkmark.shield"
  var body: some View {
    Label(title, systemImage: symbol).font(.caption.weight(.medium)).padding(.horizontal, 10)
      .padding(.vertical, 7).background(KittyTheme.soft, in: Capsule()).foregroundStyle(
        KittyTheme.accent)
  }
}
struct PrimaryButton: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.headline).frame(maxWidth: .infinity).padding(.vertical, 17)
      .background(
        KittyTheme.accent.opacity(configuration.isPressed ? 0.8 : 1),
        in: RoundedRectangle(cornerRadius: 17)
      ).foregroundStyle(KittyTheme.background)
  }
}
struct EmptyState: View {
  let title, message: String
  var symbol: String = "tray"
  var body: some View {
    VStack(spacing: 14) {
      Image(systemName: symbol).font(.largeTitle).foregroundStyle(KittyTheme.accent)
      Text(title).font(.title3.bold())
      Text(message).font(.body).foregroundStyle(KittyTheme.secondary).multilineTextAlignment(
        .center)
    }.frame(maxWidth: .infinity).padding(30)
  }
}
extension View {
  func kittyBackground() -> some View {
    background(KittyTheme.background).foregroundStyle(KittyTheme.ink)
  }
}
