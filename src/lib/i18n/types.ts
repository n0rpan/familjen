export type Language = 'nb' | 'sv' | 'en'

export const LANGUAGES: { code: Language; name: string; flag: string }[] = [
  { code: 'nb', name: 'Norsk', flag: '🇳🇴' },
  { code: 'sv', name: 'Svenska', flag: '🇸🇪' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
]

export const DEFAULT_LANGUAGE: Language = 'nb'

export interface TranslationStrings {
  // Navigation
  nav: {
    home: string
    weekPlan: string
    feed: string
    recipes: string
    rememberList: string
    shoppingList: string
    settings: string
    admin: string
    logout: string
    more: string
  }

  // Common
  common: {
    save: string
    cancel: string
    delete: string
    edit: string
    add: string
    close: string
    loading: string
    error: string
    success: string
    confirm: string
    yes: string
    no: string
    or: string
    optional: string
    required: string
    search: string
    noResults: string
    retry: string
    back: string
    next: string
    skip: string
    done: string
    today: string
    yesterday: string
    tomorrow: string
    day: string
    days: string
    week: string
    month: string
    year: string
    dismiss: string
    accept: string
    previousDay: string
    nextDay: string
    remove: string
    saving: string
    pending: string
    syncing: string
    sync: string
    offline: string
    backOnline: string
    creating: string
    finish: string
    items: string
    confirmDelete: string
    free: string
  }

  // Date/Time
  date: {
    weekdays: string[]
    weekdaysShort: string[]
    months: string[]
    monthsShort: string[]
    weekLabel: string // "Uke" / "Vecka" / "Week"
    weekFormat: string // "Uke {week}, {year}"
    birthday: string // "{name} fyller år" / "{name}'s birthday"
  }

  // Home page
  home: {
    welcome: string // "Velkommen til Familjen!"
    todayOverview: string
    noPickupsToday: string
    noMealPlanned: string
    noTasksToday: string
    pickup: string
    pickups: string
    meal: string
    task: string
    tasks: string
    event: string
    events: string
    picksUp: string // "{name} henter"
    everyoneHome: string
    memberAway: string
    membersAway: string
    birthdayWishes: string // "Happy birthday!" / "Gratulerer med dagen!"
    allReadyForToday: string // "All ready for today"
    thingNeedsAttention: string // "1 thing needs attention"
    thingsNeedAttention: string // "{count} things need attention"
    missingPickup: string // "Missing pickup"
    missingPickupFor: string // "Missing pickup for {name}"
    missingDinner: string // "Missing dinner plan"
    missingPickupAndDinner: string // "Missing pickup and dinner"
    missingPickupForAndDinner: string // "Missing pickup for {name} and dinner"
  }

  // Login page
  login: {
    title: string
    subtitle: string
    emailLabel: string
    emailPlaceholder: string
    continueWithGoogle: string
    sendMagicLink: string
    sendCode: string
    sending: string
    checkEmail: string
    checkEmailDesc: string
    enterCode: string
    enterCodeDesc: string
    orClickLink: string
    verifying: string
    invalidCode: string
    codeExpired: string
    resendCode: string
    differentEmail: string
    secureLogin: string
    errorNotAllowed: string
    errorAuthFailed: string
    errorGeneric: string
  }

  // Week planner
  week: {
    title: string
    editPickup: string
    editMeal: string
    addEvent: string
    editEvent: string
    addTask: string
    editTask: string
    copyLastWeek: string
    copyLastWeekConfirm: string
    clearWeek: string
    clearWeekConfirm: string
    quickPickup: string
    quickPickupConfirm: string
    weekContext: string
    weekContextPlaceholder: string
    noPickup: string
    customMeal: string
    selectRecipe: string
    selectPicker: string
    selectChild: string
    selectMember: string
    aiSuggestions: string
    getAiSuggestions: string
    generating: string
    applyAll: string
    applySuggestion: string
    noSuggestions: string
    eventTitle: string
    eventType: string
    eventTypes: {
      work: string
      travel: string
      family: string
      other: string
    }
    startDate: string
    endDate: string
    taskTitle: string
    taskType: string
    taskTypes: {
      bring: string
      appointment: string
      reminder: string
      activity: string
      closure: string
      other: string
    }
    taskTime: string
    taskNotes: string
    markDone: string
    markUndone: string
    sendToWorkCalendar: string
    removeFromWorkCalendar: string
    more: string // "+{count} more"
    showLess: string
    calendar: string
    family: string  // "Familien" - Family row label
    familyEvent: string  // "Familiehendelse" - Family event
    // AI Modal
    aiModalTitle: string
    suggestions: string
    generatingSuggestions: string
    takesAFewSeconds: string
    couldNotGenerate: string
    dishName: string
    addIngredient: string
    ingredient: string
    amount: string
    saveAsRecipe: string
    useThis: string
    editAndSave: string
    noDaysNeedSuggestions: string
    use: string
    addToShoppingList: string
    ingredientsAdded: string
    noIngredients: string
    // External suggestions
    suggestion: string
    reviewSuggestions: string
    remaining: string
    originalMessage: string
    aiSuggestion: string
    confidence: string
    noMoreSuggestions: string
    allSuggestionsReviewed: string
  }

  // Settings page
  settings: {
    title: string
    subtitle: string
    household: string
    householdName: string
    members: string
    addMember: string
    editMember: string
    memberName: string
    memberShortName: string
    memberEmail: string
    memberWorkEmail: string
    memberBirthDate: string
    memberAllergies: string
    isParent: string
    isParentDesc: string
    isHouseholdAdmin: string
    children: string
    addChild: string
    editChild: string
    childName: string
    childBirthDate: string
    childLocation: string
    childLocationType: string
    childLocationTypes: {
      kindergarten: string
      school: string
    }
    childColor: string
    childAllergies: string
    profile: string
    language: string
    selectLanguage: string
    dangerZone: string
    deleteChild: string
    deleteChildConfirm: string
    deleteMember: string
    deleteMemberConfirm: string
    calendarSyncHint: string
    calendarSyncDesc: string
    // Additional profile strings
    noAllergies: string
    addAllergy: string
    noRegistered: string
    householdAdminBadge: string
    allergyPlaceholder: string
    shortNamePlaceholder: string
    workEmailPlaceholder: string
    tryReloadPage: string
    // AI privacy settings
    shareNamesWithAi: string
    shareNamesEnabled: string
    shareNamesDisabled: string
    // Family calendar settings
    familyCalendar: string
    familyCalendarUrl: string
    familyCalendarHint: string
    lastSynced: string
  }

  // Recipes page
  recipes: {
    title: string
    addRecipe: string
    editRecipe: string
    searchPlaceholder: string
    noRecipes: string
    noRecipesDesc: string
    recipeName: string
    ingredients: string
    ingredientsPlaceholder: string
    instructions: string
    instructionsPlaceholder: string
    isFavorite: string
    isQuick: string
    isKidFriendly: string
    deleteRecipe: string
    deleteRecipeConfirm: string
    portions: string
    cookingTime: string
    minutes: string
    // Section headers and badges
    favorites: string
    allRecipes: string
    quick: string // Short badge
    kidFriendly: string // Short badge
    noRecipesFound: string
    ingredientsHeader: string // Uppercase section header
  }

  // Shopping list page
  shopping: {
    title: string
    addItem: string
    itemPlaceholder: string
    emptyList: string
    emptyListDesc: string
    clearChecked: string
    clearAll: string
    clearAllConfirm: string
    quantity: string // Short "Qty"
    groceries: string // List name
    otherStores: string // List name
    // View modes
    viewMode: string
    newestFirst: string
    byCategory: string
    // Filters
    filterAll: string
    filterGroceries: string
    filterHome: string
    filterOther: string
    // Duplicate prevention
    alreadyOnList: string
    changeQuantity: string
    // Undo
    itemRemoved: string
    undo: string
    // Accessibility
    markAsBought: string
    markAsNotBought: string
    deleteItemLabel: string
    // Suggestions
    suggestions: string
    basedOnMeals: string
    planMealsForSuggestions: string
    aisles: {
      produce: string
      dairy: string
      meat: string
      frozen: string
      pantry: string
      beverages: string
      household: string
      home: string
      electronics: string
      other: string
    }
  }

  // Admin page
  admin: {
    title: string
    allowedEmails: string
    addEmail: string
    emailPlaceholder: string
    canCreateHousehold: string
    isAdmin: string
    appSettings: string
    aiModel: string
    households: string
    noHouseholds: string
    auditLog: string
    showAuditLog: string
    hideAuditLog: string
    calendar: string
    calendarConnected: string
    calendarNotConnected: string
    connectCalendar: string
    syncCalendar: string
    syncing: string
    lastSync: string
    syncedEvents: string
    deleteEmail: string
    deleteEmailConfirm: string
    // Extended admin
    userAccessDesc: string
    addUser: string
    canCreateOwn: string
    becomesHouseholdAdmin: string
    email: string
    action: string
    unnamed: string
    usersAddedViaSettings: string
    householdsOverview: string
    householdsDesc: string
    noHouseholdsYet: string
    membersCount: string
    childrenCount: string
    householdsManageViaSettings: string
    latestChanges: string
    noActivityYet: string
    actionCreated: string
    actionUpdated: string
    actionDeleted: string
    entityPickup: string
    entityMeal: string
    entityChild: string
    entityMember: string
    entityHousehold: string
    entityRecipe: string
    newEntry: string
    deletedEntry: string
    aiSettings: string
    aiSettingsDesc: string
    openrouterModel: string
    priceNote: string
    modelTestHint: string
    calendarDesc: string
    connected: string
    notConnected: string
    syncedEventsCount: string
    connectGoogleCalendar: string
    syncNow: string
    reconnect: string
    calendarAutoMatchDesc: string
    security: string
    securityDesc: string
    loadingModels: string
    selectModel: string
    searchModels: string
    noModelsFound: string
    syncSuccess: string
    emailExists: string
    userAddedCanCreate: string
    userAdded: string
    cannotDeleteAdmin: string
    modelUpdated: string
    appAdmin: string
    householdAdmin: string
    // Unmatched calendar invites
    unmatchedInvites: string
    unmatchedInvitesDesc: string
    emailMaskedForPrivacy: string
    expiresIn: string
    expiringToday: string
    assign: string
    eventAssigned: string
  }

  // New household wizard
  wizard: {
    welcome: string
    welcomeSubtitle: string
    householdName: string
    householdNamePlaceholder: string
    yourName: string
    yourNamePlaceholder: string
    yourBirthDate: string
    yourAllergies: string
    allergiesPlaceholder: string
    allergiesHint: string
    addChildren: string
    addChildrenSubtitle: string
    childNamePlaceholder: string
    invitePartner: string
    invitePartnerSubtitle: string
    partnerName: string
    partnerNamePlaceholder: string
    partnerEmail: string
    partnerEmailPlaceholder: string
    partnerEmailHint: string
    allDone: string
    allDoneSubtitle: string
    goToWeekPlan: string
    waitingForInvite: string
    waitingForInviteDesc: string
    backToHome: string
    // Extended wizard
    yearsOld: string
    locationName: string
    locationNamePlaceholder: string
    loginEmail: string
    loginEmailHint: string
  }

  // Errors
  errors: {
    generic: string
    notFound: string
    unauthorized: string
    forbidden: string
    networkError: string
    loadFailed: string
    saveFailed: string
    deleteFailed: string
    invalidInput: string
    // Specific errors
    couldNotLoadHousehold: string
    couldNotLoadMembers: string
    couldNotLoadChildren: string
    couldNotLoadPickups: string
    couldNotLoadMeals: string
    couldNotLoadRecipes: string
    couldNotLoadEvents: string
    couldNotLoadTasks: string
    couldNotSavePickup: string
    couldNotSaveMeal: string
    couldNotSaveEvent: string
    couldNotSaveTask: string
    couldNotCreateHousehold: string
    couldNotAddMember: string
    couldNotAddChild: string
    aiSuggestionFailed: string
    calendarSyncFailed: string
    invalidUrl: string
  }

  // Success messages
  success: {
    saved: string
    deleted: string
    copied: string
    cleared: string
    emailAdded: string
    memberAdded: string
    childAdded: string
    recipeAdded: string
    calendarSynced: string
    syncedEvents: string
  }

  // Remember page (Huskeliste)
  remember: {
    title: string
    subtitle: string
    remindersTab: string
    wishlistsTab: string
    todayReminders: string
    weekReminders: string
    laterReminders: string
    recurringReminders: string
    addReminder: string
    editReminder: string
    reminderTitle: string
    reminderDate: string
    reminderTime: string
    reminderNotes: string
    reminderCategory: string
    reminderPriority: string
    assignTo: string
    unassigned: string
    snooze: string
    snoozeUntil: string
    // Categories
    categories: {
      bill: string
      insurance: string
      car: string
      home: string
      health: string
      subscription: string
      other: string
    }
    // Priority
    priorities: {
      low: string
      normal: string
      high: string
    }
    // Task types (extended)
    taskTypes: {
      bring: string
      appointment: string
      reminder: string
      activity: string
      closure: string
      other: string
    }
    // Recurrence
    recurring: string
    recurrencePattern: string
    daily: string
    weekly: string
    biweekly: string
    monthly: string
    yearly: string
    repeatOn: string
    repeatEvery: string
    until: string
    // Status
    open: string
    done: string
    snoozed: string
    overdue: string
    upcoming: string
    today: string
    thisWeek: string
    later: string
    // AI
    aiInput: string
    aiInputPlaceholder: string
    aiParsing: string
    aiConfirm: string
    aiEdit: string
    aiConfidence: string
    aiConfidenceHigh: string
    aiConfidenceMedium: string
    aiConfidenceLow: string
    useThis: string
    // Empty states
    noReminders: string
    noRemindersDesc: string
    addFirstReminder: string
  }

  // Wishlists
  wishlists: {
    title: string
    createWishlist: string
    editWishlist: string
    deleteWishlist: string
    deleteWishlistConfirm: string
    wishlistName: string
    occasion: string
    occasionDate: string
    makePublic: string
    makePublicDesc: string
    // Occasions
    occasions: {
      birthday: string
      christmas: string
      anniversary: string
      general: string
      other: string
    }
    // Items
    addItem: string
    editItem: string
    deleteItem: string
    itemName: string
    itemDescription: string
    itemLink: string
    itemPrice: string
    itemPriority: string
    itemQuantity: string
    buyerNotes: string
    buyerNotesDesc: string
    // Status
    reserve: string
    unreserve: string
    markFulfilled: string
    markDismissed: string
    reserved: string
    reservedBy: string
    fulfilled: string
    fulfilledBy: string
    // Empty states
    noWishlists: string
    noWishlistsDesc: string
    noItems: string
    noItemsDesc: string
    // Counts
    items: string
    item: string
  }

  // Universal AI Input
  ai: {
    inputPlaceholder: string
    add: string
    change: string
    delete: string
    complete: string
    added: string
    changed: string
    edit: string
    edited: string
    deleted: string
    completed: string
    undo: string
    parsing: string
    confirmDelete: string
  }

  // Push Notifications
  notifications: {
    title: string
    description: string
    enable: string
    disable: string
    enabled: string
    disabled: string
    unsupported: string
    unsupportedDesc: string
    denied: string
    deniedDesc: string
    preferences: string
    preferencesDesc: string
    pickupAssigned: string
    pickupAssignedDesc: string
    mealChanged: string
    mealChangedDesc: string
    taskAdded: string
    taskAddedDesc: string
    eventAffectsMe: string
    eventAffectsMeDesc: string
    testNotification: string
    testSent: string
  }

  // Install / Add to home screen
  install: {
    title: string
    description: string
    install: string
    installed: string
    installedDesc: string
    howTo: string
    iosStep1: string
    iosStep1b: string
    iosStep2: string
    iosStep3: string
    androidStep1: string
    androidStep2: string
  }

  // App update
  update: {
    available: string
    description: string
    refresh: string
    later: string
  }
}
