import React from 'react';
import { SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';

const groups = [
  { name: 'Bangalore Flat', members: '4 members', balance: '₹2,450.00', status: 'You are owed' },
  { name: 'Goa Trip', members: '5 members', balance: '₹1,280.00', status: 'You owe' },
  { name: 'Weekend plans', members: '3 members', balance: '₹0.00', status: 'Settled up' },
];

export default function App() {
  return <SafeAreaView style={styles.safe}><StatusBar barStyle="dark-content" /><ScrollView contentContainerStyle={styles.container}>
    <Text style={styles.brand}>● Together</Text><Text style={styles.eyebrow}>YOUR SHARED EXPENSES</Text><Text style={styles.title}>Good evening 👋</Text><Text style={styles.subtitle}>Here's where things stand.</Text>
    <View style={styles.total}><Text style={styles.labelLight}>Total balance</Text><Text style={styles.totalAmount}>₹3,730.00</Text><Text style={styles.labelLight}>Across all your groups</Text></View>
    <View style={styles.row}><View style={styles.metric}><Text style={styles.label}>You are owed</Text><Text style={styles.amountGreen}>₹2,450</Text></View><View style={styles.metric}><Text style={styles.label}>You owe</Text><Text style={styles.amount}>₹1,280</Text></View></View>
    <View style={styles.section}><Text style={styles.heading}>Your groups</Text><Text style={styles.subtitle}>Shared spaces for everyday expenses.</Text></View>
    {groups.map((g) => <View style={styles.group} key={g.name}><View style={styles.groupIcon}><Text>⌂</Text></View><View style={{flex:1}}><Text style={styles.groupName}>{g.name}</Text><Text style={styles.label}>{g.members}</Text></View><View style={{alignItems:'flex-end'}}><Text style={styles.groupAmount}>{g.balance}</Text><Text style={styles.label}>{g.status}</Text></View></View>)}
    <Text style={styles.footer}>Shared expenses, made simple.</Text>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({safe:{flex:1,backgroundColor:'#fbfcfb'},container:{padding:22,paddingTop:28},brand:{fontSize:22,fontWeight:'800',color:'#16865c',marginBottom:34},eyebrow:{fontSize:10,letterSpacing:1.4,color:'#849088',fontWeight:'700'},title:{fontSize:29,fontWeight:'800',color:'#17251f',marginTop:8},subtitle:{fontSize:13,color:'#75817b',marginTop:5},total:{backgroundColor:'#183c2e',borderRadius:16,padding:21,marginTop:26},labelLight:{fontSize:12,color:'#c1d4c9'},totalAmount:{fontSize:31,fontWeight:'800',color:'#fff',marginVertical:8},row:{flexDirection:'row',gap:12,marginTop:12},metric:{flex:1,backgroundColor:'#fff',borderWidth:1,borderColor:'#e9eeea',borderRadius:13,padding:16},label:{fontSize:11,color:'#75817b',marginTop:5},amount:{fontSize:21,fontWeight:'700',color:'#17251f',marginTop:8},amountGreen:{fontSize:21,fontWeight:'700',color:'#16865c',marginTop:8},section:{marginTop:37,marginBottom:15},heading:{fontSize:20,fontWeight:'800',color:'#17251f'},group:{backgroundColor:'#fff',borderWidth:1,borderColor:'#e9eeea',borderRadius:13,padding:14,marginBottom:9,flexDirection:'row',alignItems:'center',gap:12},groupIcon:{width:40,height:40,borderRadius:12,backgroundColor:'#eaf4ed',alignItems:'center',justifyContent:'center'},groupName:{fontSize:13,fontWeight:'700',color:'#17251f'},groupAmount:{fontSize:12,fontWeight:'700',color:'#17251f'},footer:{textAlign:'center',fontSize:11,color:'#a3ada6',marginTop:35,marginBottom:20}});
