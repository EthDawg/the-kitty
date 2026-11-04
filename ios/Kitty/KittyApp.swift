import SwiftUI

@main struct KittyApp: App {
  @StateObject private var store = KittyStore()
  var body: some Scene {
    WindowGroup { RootView().environmentObject(store).tint(KittyTheme.accent) }
  }
}
struct RootView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.scenePhase) private var scenePhase
  var body: some View {
    Group {
      if store.mode == .welcome {
        WelcomeView()
      } else {
        TabView(selection: $store.selectedTab) {
          NavigationStack { HomeView() }.tabItem { Label("Home", systemImage: "house") }.tag(0)
          NavigationStack { ActivityView() }.tabItem {
            Label("Activity", systemImage: "list.bullet.rectangle")
          }.tag(1)
          NavigationStack { InsightsView() }.tabItem {
            Label("Insights", systemImage: "chart.bar.xaxis")
          }.tag(2)
          NavigationStack { GoalsView() }.tabItem { Label("Goals", systemImage: "flag") }.tag(3)
          NavigationStack { AskView() }.tabItem {
            Label("Ask", systemImage: "bubble.left.and.bubble.right")
          }.tag(4)
        }
      }
    }
    .foregroundStyle(KittyTheme.ink)
    .sheet(isPresented: $store.showSettings) {
      NavigationStack { SettingsView(google: store.google) }.environmentObject(store)
    }
    .sheet(isPresented: $store.showImport) {
      NavigationStack { ImportView() }.environmentObject(store)
    }
    .sheet(isPresented: $store.showAccounts) {
      NavigationStack { AccountsView() }.environmentObject(store)
    }
    .sheet(isPresented: $store.showHouseholdSetup) {
      NavigationStack { HouseholdSetupView() }.environmentObject(store)
    }
    .alert(
      "Let's sort that out",
      isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })
    ) {
      Button("OK", role: .cancel) { store.error = nil }
    } message: {
      Text(store.error ?? "")
    }
    .alert(
      "The Kitty",
      isPresented: Binding(get: { store.notice != nil }, set: { if !$0 { store.notice = nil } })
    ) {
      Button("OK", role: .cancel) { store.notice = nil }
    } message: {
      Text(store.notice ?? "")
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active && store.mode == .connected && !store.busy {
        Task { await store.refresh() }
      }
    }
  }
}
struct WelcomeView: View {
  @EnvironmentObject var store: KittyStore
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        HStack {
          Image(systemName: "pawprint.fill").foregroundStyle(KittyTheme.accent)
          Text("THE KITTY").font(.subheadline.weight(.bold)).tracking(3)
          Spacer()
        }.padding(.top, 24)
        Image("Welcome").resizable().scaledToFit().frame(maxWidth: .infinity).frame(height: 260)
          .accessibilityHidden(true)
        Text("A little clarity.\nA lot more calm.").font(
          .system(.largeTitle, design: .rounded, weight: .bold)
        ).fixedSize(horizontal: false, vertical: true)
        Text("Your household money, together.\nYour Google Sheet, always yours.").font(.title3)
          .foregroundStyle(KittyTheme.secondary).fixedSize(horizontal: false, vertical: true)
        VStack(alignment: .leading, spacing: 14) {
          Label("See where your money goes", systemImage: "chart.bar")
          Label("Make room for what matters", systemImage: "flag")
          Label(
            "Bring your numbers to your favourite AI", systemImage: "bubble.left.and.bubble.right")
        }.font(.subheadline)
        Button {
          store.openDemo()
        } label: {
          Text("Explore the Davies demo")
        }.buttonStyle(PrimaryButton()).accessibilityIdentifier("exploreDemo")
        Button {
          store.showSettings = true
        } label: {
          Text("Connect my Google Sheet").font(.headline).frame(maxWidth: .infinity, minHeight: 44)
        }.accessibilityIdentifier("connectSheet")
        Button {
          store.showHouseholdSetup = true
        } label: {
          Text(store.setupDraft.isLocked ? "Resume household setup" : "Start a new household")
            .font(.headline).frame(maxWidth: .infinity, minHeight: 44)
        }.accessibilityIdentifier("startHousehold")
        Text("The demo is fictional. No account needed to explore.").font(.footnote)
          .foregroundStyle(KittyTheme.secondary).frame(maxWidth: .infinity).multilineTextAlignment(
            .center)
      }.padding(.horizontal, 26).padding(.bottom, 30).frame(maxWidth: 600)
    }.frame(maxWidth: .infinity).kittyBackground()
  }
}
