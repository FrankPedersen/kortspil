targetScope = 'resourceGroup'

@description('Date-based suffix used to keep globally named services unique.')
@minLength(8)
@maxLength(8)
param suffix string

@description('Optional existing App Service name override, such as the verified replacement app.')
param appNameOverride string = ''

@description('Public lobby URL that users open in their browser.')
param publicAppUrl string = 'https://www.kontraktbridge.dk/kortspil'

@description('Name of the existing Entra-only Azure SQL logical server.')
param sqlServerName string = 'kort'

@description('Resource group containing the existing Azure SQL logical server.')
param sqlServerResourceGroupName string = 'kortspil-prod-weu'

@description('Name of the existing Azure SQL database.')
param databaseName string = 'free-sql-db-1381191'

@description('Current outbound IPv4 addresses of the App Service, used for SQL firewall rules.')
param appOutboundIps array

@description('Microsoft identity app registration client ID.')
param microsoftClientId string = '4d1ed956-06d0-4105-a6b7-78ee5d483c28'

@secure()
@description('Microsoft identity app registration client secret.')
param microsoftClientSecret string

@description('Azure region for the Kortspil resources.')
param location string = resourceGroup().location

var appName = empty(appNameOverride) ? 'kortspil-api-${suffix}' : appNameOverride
var appPlanName = 'kortspil-plan-${suffix}'
var webPubSubName = 'kortspil-wps-${suffix}'
var workspaceName = 'kortspil-law-${suffix}'
var appInsightsName = 'kortspil-ai-${suffix}'

resource appPlan 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: appPlanName
  location: location
  sku: {
    name: 'B1'
    tier: 'Basic'
    size: 'B1'
    capacity: 1
  }
  kind: 'linux'
  properties: {
    reserved: true
    perSiteScaling: false
    zoneRedundant: false
  }
}

resource webApp 'Microsoft.Web/sites@2022-09-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appPlan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      alwaysOn: true
      ftpsState: 'Disabled'
      http20Enabled: true
      linuxFxVersion: 'NODE|24-lts'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      webSocketsEnabled: true
      appSettings: [
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~24'
        }
        {
          name: 'KORTSPIL_APP_SERVICE_AUTH_ENABLED'
          value: 'true'
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'HOST'
          value: '0.0.0.0'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
        {
          name: 'ENABLE_ORYX_BUILD'
          value: 'false'
        }
        {
          name: 'SQL_SERVER'
          value: '${sqlServerName}${environment().suffixes.sqlServerHostname}'
        }
        {
          name: 'SQL_DATABASE'
          value: databaseName
        }
        {
          name: 'SQL_POOL_MAX'
          value: '5'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
          value: microsoftClientSecret
        }
        {
          name: 'PUBLIC_APP_URL'
          value: publicAppUrl
        }
      ]
    }
  }
}

resource authSettings 'Microsoft.Web/sites/config@2022-03-01' = {
  parent: webApp
  name: 'authsettingsV2'
  properties: {
    platform: {
      enabled: true
      runtimeVersion: '~1'
    }
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'RedirectToLoginPage'
    }
    identityProviders: {
      apple: {
        enabled: false
      }
      azureActiveDirectory: {
        enabled: true
        registration: {
          openIdIssuer: '${environment().authentication.loginEndpoint}common/v2.0'
          clientId: microsoftClientId
          clientSecretSettingName: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
        }
        validation: {
          allowedAudiences: [
            microsoftClientId
          ]
        }
      }
      facebook: {
        enabled: false
      }
      gitHub: {
        enabled: false
      }
      google: {
        enabled: false
      }
      legacyMicrosoftAccount: {
        enabled: false
      }
      twitter: {
        enabled: false
      }
    }
    login: {
      tokenStore: {
        enabled: true
      }
    }
    httpSettings: {
      requireHttps: true
    }
  }
}

module sqlAppFirewall 'sql-app-firewall.bicep' = {
  name: 'kortspilSqlAppFirewall-${suffix}'
  scope: resourceGroup(sqlServerResourceGroupName)
  params: {
    sqlServerName: sqlServerName
    appOutboundIps: appOutboundIps
  }
}

resource webPubSub 'Microsoft.SignalRService/webPubSub@2024-03-01' = {
  name: webPubSubName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'Free_F1'
    capacity: 1
    tier: 'Free'
  }
  properties: {
    disableAadAuth: false
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    networkACLs: {
      defaultAction: 'Deny'
      ipRules: [
        {
          action: 'Allow'
          value: '0.0.0.0/0'
        }
        {
          action: 'Allow'
          value: '::/0'
        }
      ]
      publicNetwork: {
        allow: [
          'ServerConnection'
          'ClientConnection'
          'RESTAPI'
          'Trace'
        ]
      }
    }
    tls: {
      clientCertEnabled: false
    }
  }
}

resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: workspaceName
  location: location
  properties: {
    retentionInDays: 30
    sku: {
      name: 'PerGB2018'
    }
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    DisableIpMasking: false
    DisableLocalAuth: false
    IngestionMode: 'LogAnalytics'
    RetentionInDays: 30
    SamplingPercentage: 100
    WorkspaceResourceId: logWorkspace.id
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output appName string = webApp.name
output appUrl string = 'https://${webApp.properties.defaultHostName}'
output appIdentityPrincipalId string = webApp.identity.principalId
output sqlServerName string = sqlServerName
output sqlDatabaseName string = databaseName
output webPubSubName string = webPubSub.name
output webPubSubHostName string = webPubSub.properties.hostName
output appInsightsName string = appInsights.name
output appOutboundIpAddresses string = webApp.properties.outboundIpAddresses
