targetScope = 'resourceGroup'

@description('Name of the existing Azure SQL logical server.')
param sqlServerName string

@description('App Service outbound IP addresses allowed to connect to Azure SQL.')
param appOutboundIps array

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' existing = {
  name: sqlServerName
}

resource appFirewallRules 'Microsoft.Sql/servers/firewallRules@2021-11-01' = [for (ip, index) in appOutboundIps: {
  parent: sqlServer
  name: 'kortspil-app-${index}'
  properties: {
    startIpAddress: ip
    endIpAddress: ip
  }
}]
