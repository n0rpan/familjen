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
    recipes: string
    shoppingList: string
    settings: string
    admin: string
    logout: string
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
    week: string
    month: string
    year: string
  }

  // Date/Time
  date: {
    weekdays: string[]
    weekdaysShort: string[]
    months: string[]
    monthsShort: string[]
    weekLabel: string // "Uke" / "Vecka" / "Week"
    weekFormat: string // "Uke {week}, {year}"
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
  }

  // Login page
  login: {
    title: string
    subtitle: string
    emailLabel: string
    emailPlaceholder: string
    continueWithGoogle: string
    sendMagicLink: string
    sending: string
    checkEmail: string
    checkEmailDesc: string
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
      other: string
    }
    taskTime: string
    taskNotes: string
    markDone: string
    markUndone: string
    sendToWorkCalendar: string
    removeFromWorkCalendar: string
    more: string // "+{count} more"
    calendar: string
  }

  // Settings page
  settings: {
    title: string
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
    aisles: {
      produce: string
      dairy: string
      meat: string
      frozen: string
      pantry: string
      beverages: string
      household: string
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
  }
}
