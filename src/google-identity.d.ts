interface GoogleCredentialResponse {
  credential: string
}

interface GoogleAccountsId {
  initialize(configuration: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
  }): void
  renderButton(parent: HTMLElement, options: {
    type?: 'standard' | 'icon'
    theme?: 'outline' | 'filled_blue' | 'filled_black'
    size?: 'large' | 'medium' | 'small'
    text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
    shape?: 'rectangular' | 'pill' | 'circle' | 'square'
    logo_alignment?: 'left' | 'center'
    width?: number
  }): void
  disableAutoSelect(): void
}

interface Window {
  google?: { accounts: { id: GoogleAccountsId } }
}

