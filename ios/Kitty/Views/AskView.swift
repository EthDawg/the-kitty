import SwiftUI

private struct AskReview: Identifiable {
  let id = UUID()
  let sheetID: String
  let text: String
  let preview: AskPreview?
}

struct AskView: View {
  @EnvironmentObject var store: KittyStore
  @State private var scope: AskScope = .overview
  @State private var destination = "external"
  @State private var providers: [AskProviderOption] = []
  @State private var review: AskReview?
  @State private var loading = false
  @State private var message: String?
  @FocusState private var focused: Bool
  private var question: String { store.askQuestion.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var client: AskServiceClient { AskServiceClient(google: store.google) }
  private let prompts: [(String, AskScope)] = [
    ("What changed in our spending?", .spending),
    ("How are we tracking toward our goals?", .goals),
    ("Explain our cash position.", .overview),
  ]
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: 8) {
            Text("A clearer picture,\none question at a time.")
              .font(.system(.title, design: .rounded, weight: .semibold))
            Text("Answers with your numbers in view.")
              .font(.subheadline).foregroundStyle(KittyTheme.secondary)
          }
          Spacer(minLength: 8)
          Image("Welcome").resizable().scaledToFit().frame(width: 64).accessibilityHidden(true)
        }
        DataStatusView()
        KittyCard {
          SectionTitle(title: "What’s on your mind?")
          TextField("Ask about your household money…", text: $store.askQuestion, axis: .vertical)
            .lineLimit(3...7).focused($focused).accessibilityIdentifier("askQuestion")
          Picker("Include", selection: $scope) {
            Text("Household overview").tag(AskScope.overview)
            Text("Spending this month").tag(AskScope.spending)
            Text("Savings goals").tag(AskScope.goals)
            if store.askTransactionID != nil { Text("Selected transaction").tag(AskScope.transaction) }
          }.tint(KittyTheme.accent).accessibilityIdentifier("askScope")
          if scope == .transaction,
            let tx = store.household?.transactions.first(where: { $0.id == store.askTransactionID }) {
            HStack(alignment: .top) {
              VStack(alignment: .leading, spacing: 4) {
                Text(tx.merchant).font(.subheadline.weight(.medium))
                Text("\(niceDate(tx.date)) · \(money(tx.amount, currency: store.currency))")
                  .font(.caption).foregroundStyle(KittyTheme.secondary)
              }
              Spacer()
              Button("Clear") { store.askTransactionID = nil; scope = .overview }.font(.subheadline)
            }
          }
          if !providers.isEmpty {
            Picker("Answer in", selection: $destination) {
              ForEach(providers, id: \.id) { provider in
                Text("The Kitty · \(provider.id == .claude ? "Claude" : "OpenAI")").tag(provider.id.rawValue)
              }
              Text("My Claude or ChatGPT app").tag("external")
            }.accessibilityIdentifier("askDestination")
          }
          Text("You’ll see the exact context before sharing anything.")
            .font(.caption).foregroundStyle(KittyTheme.secondary)
        }
        VStack(alignment: .leading, spacing: 10) {
          ForEach(prompts, id: \.0) { prompt in
            Button {
              store.askQuestion = prompt.0; scope = prompt.1; focused = false
            } label: {
              HStack {
                Text(prompt.0).font(.subheadline)
                Spacer()
                Image(systemName: "arrow.up.left").font(.caption)
              }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                .background(KittyTheme.surface, in: RoundedRectangle(cornerRadius: 16))
            }
          }
        }
        Button {
          focused = false
          Task { await prepareReview() }
        } label: {
          if loading { ProgressView("Preparing your summary…").tint(KittyTheme.background) }
          else { Label("Review & ask", systemImage: "bubble.left.and.bubble.right") }
        }.buttonStyle(PrimaryButton())
          .disabled(question.isEmpty || question.count > 2000 || loading)
          .opacity(question.isEmpty ? 0.5 : 1)
          .accessibilityIdentifier("reviewAsk")
        if question.count > 2000 {
          Text("Keep your question under 2,000 characters.").font(.caption).foregroundStyle(KittyTheme.warning)
        }
        if let message { Text(message).font(.subheadline).foregroundStyle(KittyTheme.warning) }
        Text(destination == "external"
          ? "Use your own Claude or ChatGPT conversation. Review the summary, then copy and paste it into your chosen app. Your Google access stays here."
          : "The Kitty sends only the context you approve to your chosen AI provider. Answers explain the recorded figures; they cannot edit your Sheet or move money.")
          .font(.caption).foregroundStyle(KittyTheme.secondary)
      }.padding(20).frame(maxWidth: 700)
    }.frame(maxWidth: .infinity).kittyBackground().navigationTitle("Ask the Kitty")
      .task(id: store.selectedSheetID) { await loadProviders() }
      .onAppear { if store.askTransactionID != nil { scope = .transaction } }
      .onChange(of: store.askTransactionID) { _, id in scope = id == nil ? .overview : .transaction }
      .onChange(of: store.selectedSheetID) { _, _ in review = nil; message = nil }
      .sheet(item: $review) { item in
        AskReviewView(review: item, onRefresh: { review = nil; Task { await prepareReview() } })
          .environmentObject(store)
      }
  }
  private func loadProviders() async {
    providers = []; destination = "external"
    guard store.mode == .connected, client.isConfigured else { return }
    let sheetID = store.selectedSheetID
    do {
      let available = try await client.capabilities()
      guard store.selectedSheetID == sheetID else { return }
      providers = available.providers
      if let first = providers.first { destination = first.id.rawValue }
    } catch {
      message = "Answers in The Kitty are unavailable right now. You can still review a summary for your own AI app."
    }
  }
  private func prepareReview() async {
    guard !question.isEmpty, question.count <= 2000, !loading else { return }
    loading = true; message = nil
    defer { loading = false }
    let sheetID = store.selectedSheetID
    let selectedTransaction = scope == .transaction ? store.askTransactionID : nil
    do {
      if let provider = AskProvider(rawValue: destination) {
        let preview = try await client.preview(sheetID: sheetID, provider: provider,
          question: question, scope: scope, transactionID: selectedTransaction)
        guard store.selectedSheetID == sheetID, store.mode == .connected else { return }
        review = AskReview(sheetID: sheetID, text: preview.providerSummary, preview: preview)
      } else {
        review = AskReview(sheetID: sheetID,
          text: store.contextForAI(question: question, scope: scope, transactionID: selectedTransaction), preview: nil)
      }
    } catch { message = error.localizedDescription }
  }
}

private struct AskReviewView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dismiss) private var dismiss
  let review: AskReview
  let onRefresh: () -> Void
  @State private var copied = false
  @State private var sending = false
  @State private var attempted = false
  @State private var response: AskResponse?
  @State private var message: String?
  @State private var showReport = false
  var body: some View {
    NavigationStack {
      List {
        if let response {
          Section("\(response.provider == .claude ? "Claude" : "OpenAI") · \(niceDate(response.asOf))") {
            Text(response.answer).font(.body).textSelection(.enabled).accessibilityIdentifier("aiAnswer")
          }
          if !response.evidence.isEmpty {
            Section("The figures behind this answer") {
              ForEach(response.evidence, id: \.id) { item in
                VStack(alignment: .leading, spacing: 5) {
                  Text(item.label).font(.subheadline.weight(.medium))
                  Text(item.value + (item.currency.map { " " + $0 } ?? "")).font(.subheadline)
                  Link("View in your Sheet", destination: item.url).font(.caption)
                }.padding(.vertical, 4)
              }
            }
          }
          Section("Keep in mind") {
            ForEach(response.limitations, id: \.self) { Text($0).font(.caption) }
          }
          Section { Button("Report a concern about this answer") { showReport = true } }
        } else {
          Section("Exactly what you’ll share") {
            Text(review.text).font(.subheadline).accessibilityIdentifier("aiSummary")
          }
          if let preview = review.preview {
            if !preview.limitations.isEmpty {
              Section("Context sent with these figures") {
                ForEach(preview.limitations, id: \.self) { Text($0).font(.caption) }
              }
            }
            Section {
              if sending { ProgressView("Asking \(preview.provider == .claude ? "Claude" : "OpenAI")…") }
              else if attempted || preview.isExpired {
                Button("Review a fresh summary", action: onRefresh)
              } else {
                Button { Task { await submit(preview) } } label: {
                  Label("Share & ask \(preview.provider == .claude ? "Claude" : "OpenAI")", systemImage: "arrow.up.circle.fill")
                }.accessibilityIdentifier("approveAISharing")
              }
              Text("Tapping Share sends the question and context above to \(preview.providerLabel). Their API privacy terms apply. Your Google credentials and Sheet link are not included.")
                .font(.caption)
              Link("Provider privacy policy", destination: URL(string: preview.provider == .claude
                ? "https://www.anthropic.com/legal/privacy" : "https://openai.com/policies/privacy-policy/")!)
                .font(.caption)
            }
          } else {
            Section {
              Button { openAI("https://claude.ai/new") } label: {
                Label("Copy summary & open Claude", systemImage: "arrow.up.right.square")
              }
              Button { openAI("https://chatgpt.com/") } label: {
                Label("Copy summary & open ChatGPT", systemImage: "arrow.up.right.square")
              }
              ShareLink(item: review.text) { Label("Share another way", systemImage: "square.and.arrow.up") }
              if copied {
                Text("Summary copied. Paste it into your conversation.")
                  .font(.subheadline).foregroundStyle(KittyTheme.positive)
              }
            }
            Section {
              Text("Only the text above is shared. It does not grant access to your Google Sheet. Your chosen service manages the conversation and any subscription.")
                .font(.caption)
            }
          }
          if let message { Section { Text(message).foregroundStyle(KittyTheme.warning) } }
        }
      }.navigationTitle(response == nil ? "Review your summary" : "Your answer")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() }.disabled(sending) } }
        .interactiveDismissDisabled(sending)
        .sheet(isPresented: $showReport) {
          NavigationStack {
            List {
              Section {
                Text("Report a problem to The Kitty’s developer. The report opens on GitHub and is public.")
                Text("No question, answer or financial records are added automatically. Describe the problem without including private details.")
                  .font(.subheadline).foregroundStyle(KittyTheme.secondary)
                Link("Open a blank support report", destination: URL(string: "https://github.com/EthDawg/the-kitty/issues/new")!)
              }
            }.navigationTitle("Report a concern").navigationBarTitleDisplayMode(.inline)
              .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { showReport = false } } }
          }
        }
    }
  }
  private func submit(_ preview: AskPreview) async {
    guard !sending, !attempted, store.selectedSheetID == review.sheetID, store.mode == .connected else { return }
    guard !preview.isExpired else { message = "This preview has expired. Review a fresh summary before sharing."; return }
    attempted = true; sending = true; message = nil
    defer { sending = false }
    do {
      let answer = try await AskServiceClient(google: store.google).ask(preview: preview)
      guard store.selectedSheetID == review.sheetID, store.mode == .connected else { return }
      response = answer
    } catch { message = error.localizedDescription }
  }
  private func openAI(_ address: String) {
    UIPasteboard.general.setItems([[UIPasteboard.typeAutomatic: review.text]],
      options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(300)])
    copied = true
    if let url = URL(string: address) { UIApplication.shared.open(url) }
  }
}
