import SwiftUI

/// Present feedback from the frontmost sheet. Presenting an alert from the
/// underlying root can dismiss the review the user is trying to recover.
private struct KittyFeedbackModifier: ViewModifier {
  @EnvironmentObject var store: KittyStore
  @State private var id = UUID()
  let isModal: Bool
  private var active: Bool {
    isModal ? store.feedbackPresenters.last == id : store.feedbackPresenters.isEmpty
  }
  func body(content: Content) -> some View {
    content
      .onAppear {
        if isModal && !store.feedbackPresenters.contains(id) { store.feedbackPresenters.append(id) }
      }
      .onDisappear {
        if isModal { store.feedbackPresenters.removeAll { $0 == id } }
      }
      .alert("Let's sort that out", isPresented: Binding(
        get: { active && store.error != nil },
        set: { if !$0 && active { store.error = nil } }
      )) {
        Button("OK", role: .cancel) { store.error = nil }
      } message: { Text(store.error ?? "") }
      .alert("The Kitty", isPresented: Binding(
        get: { active && store.notice != nil },
        set: { if !$0 && active { store.notice = nil } }
      )) {
        Button("OK", role: .cancel) { store.notice = nil }
      } message: { Text(store.notice ?? "") }
  }
}

extension View {
  func kittyFeedback(isModal: Bool = true) -> some View {
    modifier(KittyFeedbackModifier(isModal: isModal))
  }
}
